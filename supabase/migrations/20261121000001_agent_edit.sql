-- Agents that can edit: a third scope, "edit", which can read, create, and change what's
-- already in its workspace: page titles, descriptions and text, database names, columns and
-- rows, and playbooks. It can move pages to the Trash (where they can be restored), never
-- delete them for good. Keys and connections made before keep exactly what they had.

alter table public.agent_keys drop constraint agent_keys_scope_check;
alter table public.agent_keys add constraint agent_keys_scope_check check (scope in ('read', 'write', 'edit'));
alter table public.oauth_codes drop constraint oauth_codes_scope_check;
alter table public.oauth_codes add constraint oauth_codes_scope_check check (scope in ('read', 'write', 'edit'));

-- Changes an agent asked for, in one transaction, all inside the key's workspace.
--
-- p_edit: {
--   pages:      [{ id, title?, description?, trash? }]           existing pages (trash: to the Trash; subpages are listed too)
--   documents:  [{ page_id, markdown, expected_updated_at }]     a page's whole new text, only if unchanged since it was read
--   databases:  [{ id, name }]                                   renamed databases
--   property_configs: [{ id, config }]                           choices added to existing columns
--   new_properties:   [{ id, database_id, name, type, position, width, config }]
--   new_pages, new_documents, new_records: rows added to existing databases
--   values:     [{ record_id, property_id, value }]              cell values (null clears)
-- }
create function public.agent_update(p_key_hash text, p_edit jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  key_id uuid;
  key_owner uuid;
  key_scope text;
  key_workspace uuid;
  ws uuid;
  next_revision bigint;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  select id, owner_id, scope, workspace_id into key_id, key_owner, key_scope, key_workspace
    from public.agent_keys where id = public.agent_key_id(p_key_hash);
  if key_owner is null then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  if key_scope <> 'edit' then
    raise exception 'This agent key can''t edit' using errcode = '42501';
  end if;
  -- One change at a time per account, like save_workspace_state.
  perform 1 from public.profiles where id = key_owner for update;
  select id into ws from public.workspaces where id = key_workspace and owner_id = key_owner;
  if ws is null then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;

  -- Everything named must already be in the key's workspace…
  if exists (select 1 from jsonb_array_elements(coalesce(p_edit->'pages', '[]')) x
               where not exists (select 1 from public.pages p where p.id = (x->>'id')::uuid and p.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'documents', '[]')) x
               where not exists (select 1 from public.pages p where p.id = (x->>'page_id')::uuid and p.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'databases', '[]')) x
               where not exists (select 1 from public.databases d where d.id = (x->>'id')::uuid and d.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'property_configs', '[]')) x
               where not exists (select 1 from public.database_properties p where p.id = (x->>'id')::uuid and p.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'new_properties', '[]')) x
               where not exists (select 1 from public.databases d where d.id = (x->>'database_id')::uuid and d.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'new_records', '[]')) x
               where not exists (select 1 from public.databases d where d.id = (x->>'database_id')::uuid and d.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'new_pages', '[]')) x
               where not exists (select 1 from public.pages p where p.id = (x->>'parent_id')::uuid and p.workspace_id = ws)) then
    raise exception 'Not this key''s workspace' using errcode = '42501';
  end if;
  -- …and a page's text is replaced only if nobody changed it since the agent read it.
  if exists (select 1 from jsonb_array_elements(coalesce(p_edit->'documents', '[]')) x
               where case when x->>'expected_updated_at' is null
                 then exists (select 1 from public.documents d where d.page_id = (x->>'page_id')::uuid)
                 else not exists (select 1 from public.documents d where d.page_id = (x->>'page_id')::uuid
                                   and d.updated_at = (x->>'expected_updated_at')::timestamptz) end) then
    raise exception 'Changed since it was read' using errcode = '40001';
  end if;

  set constraints all deferred;
  update public.pages p
    set title = coalesce(x.title, p.title),
        description = coalesce(x.description, p.description),
        deleted_at = case when x.trash then coalesce(p.deleted_at, now()) else p.deleted_at end,
        updated_at = now()
    from jsonb_to_recordset(coalesce(p_edit->'pages', '[]')) as x(id uuid, title text, description text, trash boolean)
    where p.id = x.id and p.workspace_id = ws;
  update public.documents d set markdown = x.markdown, content = null, updated_at = now()
    from jsonb_to_recordset(coalesce(p_edit->'documents', '[]')) as x(page_id uuid, markdown text)
    where d.page_id = x.page_id and d.workspace_id = ws;
  insert into public.documents(page_id, workspace_id, markdown)
    select x.page_id, ws, x.markdown
    from jsonb_to_recordset(coalesce(p_edit->'documents', '[]')) as x(page_id uuid, markdown text)
    where not exists (select 1 from public.documents d where d.page_id = x.page_id);
  update public.databases d set name = x.name, updated_at = now()
    from jsonb_to_recordset(coalesce(p_edit->'databases', '[]')) as x(id uuid, name text)
    where d.id = x.id and d.workspace_id = ws;
  update public.database_properties p set config = x.config
    from jsonb_to_recordset(coalesce(p_edit->'property_configs', '[]')) as x(id uuid, config jsonb)
    where p.id = x.id and p.workspace_id = ws;
  insert into public.database_properties(id, workspace_id, database_id, name, type, position, width, config)
    select x.id, ws, x.database_id, x.name, x.type, x.position, coalesce(x.width, 200), coalesce(x.config, '{}')
    from jsonb_to_recordset(coalesce(p_edit->'new_properties', '[]')) as x(id uuid, database_id uuid, name text, type text,
      position double precision, width integer, config jsonb)
    where x.type not in ('title', 'relation', 'rollup', 'formula');
  insert into public.pages(id, workspace_id, parent_id, title, icon, kind, description, position, favorite, deleted_at)
    select x.id, ws, x.parent_id, coalesce(x.title, 'Untitled'), '', 'document', '', x.position, false, null
    from jsonb_to_recordset(coalesce(p_edit->'new_pages', '[]')) as x(id uuid, parent_id uuid, title text, position double precision);
  insert into public.documents(page_id, workspace_id, markdown)
    select x.page_id, ws, coalesce(x.markdown, '')
    from jsonb_to_recordset(coalesce(p_edit->'new_documents', '[]')) as x(page_id uuid, markdown text)
    join public.pages p on p.id = x.page_id and p.workspace_id = ws;
  insert into public.database_records(id, workspace_id, database_id, page_id, position)
    select x.id, ws, x.database_id, x.page_id, x.position
    from jsonb_to_recordset(coalesce(p_edit->'new_records', '[]')) as x(id uuid, database_id uuid, page_id uuid, position double precision);
  -- Cell values, for rows in this workspace and columns of the row's own database.
  insert into public.record_values(record_id, property_id, database_id, workspace_id, value)
    select r.id, p.id, r.database_id, ws, x.value
    from jsonb_to_recordset(coalesce(p_edit->'values', '[]')) as x(record_id uuid, property_id uuid, value jsonb)
    join public.database_records r on r.id = x.record_id and r.workspace_id = ws
    join public.database_properties p on p.id = x.property_id and p.database_id = r.database_id
      and p.type not in ('relation', 'rollup', 'formula', 'created_time', 'updated_time')
    where x.value is not null and x.value <> 'null'::jsonb
    on conflict (record_id, property_id) do update set value = excluded.value;
  delete from public.record_values v
    using jsonb_to_recordset(coalesce(p_edit->'values', '[]')) as x(record_id uuid, property_id uuid, value jsonb)
    where v.record_id = x.record_id and v.property_id = x.property_id and v.workspace_id = ws
      and (x.value is null or x.value = 'null'::jsonb);
  update public.database_records r set updated_at = now()
    from (select distinct (x->>'record_id')::uuid as id from jsonb_array_elements(coalesce(p_edit->'values', '[]')) x) changed
    where r.id = changed.id and r.workspace_id = ws;

  update public.agent_keys set last_used_at = now() where id = key_id;
  update public.profiles set sync_revision = sync_revision + 1, updated_at = now()
    where id = key_owner returning sync_revision into next_revision;
  return next_revision;
end $$;

revoke all on function public.agent_update(text, jsonb) from public;
grant execute on function public.agent_update(text, jsonb) to anon, authenticated;

-- Keys that can edit can also create.
create or replace function public.agent_create(p_key_hash text, p_creation jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  key_id uuid;
  key_owner uuid;
  key_scope text;
  key_workspace uuid;
  ws uuid[];
  new_db uuid[];
  next_revision bigint;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  select id, owner_id, scope, workspace_id into key_id, key_owner, key_scope, key_workspace
    from public.agent_keys where id = public.agent_key_id(p_key_hash);
  if key_owner is null then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  if key_scope not in ('write', 'edit') then
    raise exception 'This agent key can only read' using errcode = '42501';
  end if;

  -- One change at a time per account, like save_workspace_state.
  perform 1 from public.profiles where id = key_owner for update;
  select coalesce(array_agg(id), '{}') into ws from public.workspaces where id = key_workspace and owner_id = key_owner;
  select coalesce(array_agg((x->>'id')::uuid), '{}') into new_db
    from jsonb_array_elements(coalesce(p_creation->'databases', '[]')) x;

  -- Everything must land in the key's workspace…
  if exists (select 1 from jsonb_array_elements(coalesce(p_creation->'pages', '[]')) x
               where (x->>'workspace_id')::uuid <> all(ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_creation->'databases', '[]')) x
               where (x->>'workspace_id')::uuid <> all(ws)) then
    raise exception 'Not this key''s workspace' using errcode = '42501';
  end if;
  -- …properties, views and rows only in databases created here…
  if exists (select 1 from (
       select x->>'database_id' as db from jsonb_array_elements(coalesce(p_creation->'properties', '[]')) x
       union all select x->>'database_id' from jsonb_array_elements(coalesce(p_creation->'views', '[]')) x
       union all select x->>'database_id' from jsonb_array_elements(coalesce(p_creation->'records', '[]')) x
     ) refs where refs.db::uuid <> all(new_db)) then
    raise exception 'Only new databases can be filled in' using errcode = '42501';
  end if;
  -- …and text is only appended to the workspace's pages that aren't in the Trash.
  if exists (select 1 from jsonb_array_elements(coalesce(p_creation->'appends', '[]')) x
               where not exists (select 1 from public.pages p
                 where p.id = (x->>'page_id')::uuid and p.workspace_id = any(ws) and p.deleted_at is null)) then
    raise exception 'Not this key''s page' using errcode = '42501';
  end if;

  set constraints all deferred;
  insert into public.pages(id, workspace_id, parent_id, title, icon, kind, database_id, description, position, favorite, deleted_at)
    select x.id, x.workspace_id, x.parent_id, coalesce(x.title, 'Untitled'), coalesce(x.icon, ''), x.kind, x.database_id,
           coalesce(x.description, ''), x.position, false, null
    from jsonb_to_recordset(coalesce(p_creation->'pages', '[]')) as x(id uuid, workspace_id uuid, parent_id uuid, title text,
      icon text, kind text, database_id uuid, description text, position double precision);
  insert into public.documents(page_id, workspace_id, markdown)
    select x.page_id, p.workspace_id, coalesce(x.markdown, '')
    from jsonb_to_recordset(coalesce(p_creation->'documents', '[]')) as x(page_id uuid, markdown text)
    join public.pages p on p.id = x.page_id and p.workspace_id = any(ws);
  insert into public.databases(id, workspace_id, page_id, name)
    select x.id, x.workspace_id, x.page_id, x.name
    from jsonb_to_recordset(coalesce(p_creation->'databases', '[]')) as x(id uuid, workspace_id uuid, page_id uuid, name text);
  insert into public.database_properties(id, workspace_id, database_id, name, type, position, width, config)
    select x.id, d.workspace_id, x.database_id, x.name, x.type, x.position, coalesce(x.width, 200), coalesce(x.config, '{}')
    from jsonb_to_recordset(coalesce(p_creation->'properties', '[]')) as x(id uuid, database_id uuid, name text, type text,
      position double precision, width integer, config jsonb)
    join public.databases d on d.id = x.database_id;
  insert into public.database_views(id, workspace_id, database_id, name, type, filters, sorts, hidden_properties, property_order, group_by)
    select x.id, d.workspace_id, x.database_id, x.name, x.type, '[]', '[]', '[]', '[]', x.group_by
    from jsonb_to_recordset(coalesce(p_creation->'views', '[]')) as x(id uuid, database_id uuid, name text, type text, group_by uuid)
    join public.databases d on d.id = x.database_id;
  insert into public.database_records(id, workspace_id, database_id, page_id, position)
    select x.id, d.workspace_id, x.database_id, x.page_id, x.position
    from jsonb_to_recordset(coalesce(p_creation->'records', '[]')) as x(id uuid, database_id uuid, page_id uuid, position double precision)
    join public.databases d on d.id = x.database_id;
  insert into public.record_values(record_id, property_id, database_id, workspace_id, value)
    select (r->>'id')::uuid, p.id, p.database_id, p.workspace_id, v.value
    from jsonb_array_elements(coalesce(p_creation->'records', '[]')) r
    cross join lateral jsonb_each(coalesce(r->'values', '{}')) v
    join public.database_properties p on p.id = v.key::uuid and p.database_id = (r->>'database_id')::uuid
    where p.type <> 'relation';
  update public.documents d
    set markdown = case when btrim(d.markdown, E' \n') = '' then a.text
                        else rtrim(d.markdown, E' \n') || E'\n\n' || a.text end,
        updated_at = now()
    from jsonb_to_recordset(coalesce(p_creation->'appends', '[]')) as a(page_id uuid, text text)
    where d.page_id = a.page_id;

  update public.agent_keys set last_used_at = now() where id = key_id;
  update public.profiles set sync_revision = sync_revision + 1, updated_at = now()
    where id = key_owner returning sync_revision into next_revision;
  return next_revision;
end $$;

revoke all on function public.agent_create(text, jsonb) from public;
grant execute on function public.agent_create(text, jsonb) to anon, authenticated;
