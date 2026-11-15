-- Moving a page (with everything inside it: subpages, databases and their rows, views and
-- files, and pages of it in the Trash) to another of the account's workspaces.
--
-- Everything is keyed by workspace, so it all moves in one transaction. Relations can't
-- cross workspaces: a relation between a database that moves and one that stays is
-- unlinked (its column stays, empty, to point somewhere else). Files are stored under their
-- workspace; the app copies them to the new place first, and their records follow here.
create function public.move_to_workspace(p_page_id uuid, p_workspace_id uuid, p_parent_id uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  source uuid;
  moved uuid[];
  dbs uuid[];
  next_revision bigint;
begin
  if me is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  -- One change at a time per account, like save_workspace_state.
  perform 1 from public.profiles where id = me for update;
  select p.workspace_id into source from public.pages p join public.workspaces w on w.id = p.workspace_id
    where p.id = p_page_id and w.owner_id = me;
  if source is null then raise exception 'Page not found' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id and owner_id = me) then
    raise exception 'Workspace not found' using errcode = '42501';
  end if;
  if source = p_workspace_id then raise exception 'It is already in that workspace' using errcode = '22023'; end if;
  if exists (select 1 from public.database_records where page_id = p_page_id) then
    raise exception 'A database row moves with its database' using errcode = '22023';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.pages where id = p_parent_id and workspace_id = p_workspace_id and deleted_at is null
  ) then
    raise exception 'That page is not in the workspace' using errcode = '22023';
  end if;

  with recursive tree as (
    select id from public.pages where id = p_page_id
    union all
    select p.id from public.pages p join tree t on p.parent_id = t.id where p.workspace_id = source
  ) select array_agg(id) into moved from tree;
  select coalesce(array_agg(id), '{}') into dbs from public.databases where page_id = any(moved);

  set constraints all deferred;
  -- Relations between a database that moves and one that stays: unlinked, both ways.
  delete from public.record_relations rr using public.database_properties p
    where rr.property_id = p.id and p.workspace_id = source and p.type = 'relation'
      and (p.database_id = any(dbs)) is distinct from (coalesce(p.config->>'related_database_id', '') = any(dbs::text[]));
  update public.database_properties p
    set config = p.config - 'related_database_id' - 'reciprocal_property_id'
    where p.workspace_id = source and p.type = 'relation' and nullif(p.config->>'related_database_id', '') is not null
      and (p.database_id = any(dbs)) is distinct from ((p.config->>'related_database_id') = any(dbs::text[]));
  -- Rollups that summarized a relation's other side keep their settings; with no links they're empty.

  update public.pages set workspace_id = p_workspace_id where id = any(moved);
  update public.documents set workspace_id = p_workspace_id where page_id = any(moved);
  update public.databases set workspace_id = p_workspace_id where id = any(dbs);
  update public.database_properties set workspace_id = p_workspace_id where database_id = any(dbs);
  update public.database_records set workspace_id = p_workspace_id where database_id = any(dbs);
  update public.record_values set workspace_id = p_workspace_id where database_id = any(dbs);
  update public.record_relations set workspace_id = p_workspace_id where database_id = any(dbs);
  update public.database_views set workspace_id = p_workspace_id where database_id = any(dbs);
  update public.attachments
    set workspace_id = p_workspace_id,
        storage_path = p_workspace_id::text || substr(storage_path, length(source::text) + 1)
    where page_id = any(moved);
  -- It lands last among its new siblings.
  update public.pages set parent_id = p_parent_id,
      position = (select coalesce(max(position), -1) + 1 from public.pages
                   where workspace_id = p_workspace_id and parent_id is not distinct from p_parent_id and id <> p_page_id),
      updated_at = now()
    where id = p_page_id;

  update public.profiles set sync_revision = sync_revision + 1, updated_at = now()
    where id = me returning sync_revision into next_revision;
  return next_revision;
end $$;

revoke all on function public.move_to_workspace(uuid, uuid, uuid) from public;
grant execute on function public.move_to_workspace(uuid, uuid, uuid) to authenticated;

-- Agents' relation values are links (record_relations), as the app saves them; before,
-- agent_update stored them as plain values, which an unlink couldn't override.
create or replace function public.agent_update(p_key_hash text, p_edit jsonb) returns bigint
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
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'property_names', '[]')) x
               where not exists (select 1 from public.database_properties p where p.id = (x->>'id')::uuid and p.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'new_properties', '[]')) x
               where not exists (select 1 from public.databases d where d.id = (x->>'database_id')::uuid and d.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'new_records', '[]')) x
               where not exists (select 1 from public.databases d where d.id = (x->>'database_id')::uuid and d.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'new_pages', '[]')) x
               where not exists (select 1 from public.pages p where p.id = (x->>'parent_id')::uuid and p.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'views', '[]')) x
               where not exists (select 1 from public.database_views v where v.id = (x->>'id')::uuid and v.workspace_id = ws))
     or exists (select 1 from jsonb_array_elements(coalesce(p_edit->'new_views', '[]')) x
               where not exists (select 1 from public.databases d where d.id = (x->>'database_id')::uuid and d.workspace_id = ws)) then
    raise exception 'Not this key''s workspace' using errcode = '42501';
  end if;
  -- …and so must whatever a column's settings point at (or be new in this edit).
  if exists (
       select 1 from (
         select x->'config' as c from jsonb_array_elements(coalesce(p_edit->'property_configs', '[]')) x
         union all select x->'config' from jsonb_array_elements(coalesce(p_edit->'new_properties', '[]')) x
       ) cfg
       where (coalesce(cfg.c->>'related_database_id', '') <> ''
              and not exists (select 1 from public.databases d where d.id::text = cfg.c->>'related_database_id' and d.workspace_id = ws))
          or exists (
               select 1 from unnest(array['reciprocal_property_id', 'relation_property_id', 'rollup_property_id']) k
               where coalesce(cfg.c->>k, '') <> ''
                 and not exists (select 1 from public.database_properties p where p.id::text = cfg.c->>k and p.workspace_id = ws)
                 and not exists (select 1 from jsonb_array_elements(coalesce(p_edit->'new_properties', '[]')) n where n->>'id' = cfg.c->>k))
     ) then
    raise exception 'Not this key''s workspace' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_edit->'pages', '[]')) x
               where x ? 'icon' and coalesce(x->>'icon', '') !~ '^(icon:[a-z0-9-]+:[a-z]+)?$') then
    raise exception 'Invalid icon' using errcode = '22023';
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
        icon = coalesce(x.icon, p.icon),
        deleted_at = case when x.trash then coalesce(p.deleted_at, now()) else p.deleted_at end,
        updated_at = now()
    from jsonb_to_recordset(coalesce(p_edit->'pages', '[]')) as x(id uuid, title text, description text, icon text, trash boolean)
    where p.id = x.id and p.workspace_id = ws;
  update public.documents d set markdown = x.markdown, content = null, updated_at = now()
    from jsonb_to_recordset(coalesce(p_edit->'documents', '[]')) as x(page_id uuid, markdown text)
    where d.page_id = x.page_id and d.workspace_id = ws;
  insert into public.documents(page_id, workspace_id, markdown)
    select x.page_id, ws, x.markdown
    from jsonb_to_recordset(coalesce(p_edit->'documents', '[]')) as x(page_id uuid, markdown text)
    where not exists (select 1 from public.documents d where d.page_id = x.page_id);
  update public.databases d
    set name = coalesce(x.name, d.name), open_mode = coalesce(x.open_mode, d.open_mode), updated_at = now()
    from jsonb_to_recordset(coalesce(p_edit->'databases', '[]')) as x(id uuid, name text, open_mode text)
    where d.id = x.id and d.workspace_id = ws;
  update public.database_properties p set config = x.config
    from jsonb_to_recordset(coalesce(p_edit->'property_configs', '[]')) as x(id uuid, config jsonb)
    where p.id = x.id and p.workspace_id = ws;
  update public.database_properties p set name = x.name
    from jsonb_to_recordset(coalesce(p_edit->'property_names', '[]')) as x(id uuid, name text)
    where p.id = x.id and p.workspace_id = ws and btrim(coalesce(x.name, '')) <> '';
  insert into public.database_properties(id, workspace_id, database_id, name, type, position, width, config)
    select x.id, ws, x.database_id, x.name, x.type, x.position, coalesce(x.width, 200), coalesce(x.config, '{}')
    from jsonb_to_recordset(coalesce(p_edit->'new_properties', '[]')) as x(id uuid, database_id uuid, name text, type text,
      position double precision, width integer, config jsonb)
    where x.type not in ('title', 'created_time', 'updated_time');
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
  update public.database_views v
    set name = coalesce(x.name, v.name),
        type = coalesce(x.type, v.type),
        filters = coalesce(x.filters, v.filters),
        sorts = coalesce(x.sorts, v.sorts),
        hidden_properties = coalesce(x.hidden_properties, v.hidden_properties),
        property_order = coalesce(x.property_order, v.property_order),
        group_by = coalesce(x.group_by, v.group_by)
    from jsonb_to_recordset(coalesce(p_edit->'views', '[]')) as x(id uuid, name text, type text, filters jsonb, sorts jsonb,
      hidden_properties jsonb, property_order jsonb, group_by uuid)
    where v.id = x.id and v.workspace_id = ws;
  insert into public.database_views(id, workspace_id, database_id, name, type, filters, sorts, hidden_properties, property_order, group_by, placement)
    select x.id, ws, x.database_id, x.name, coalesce(x.type, 'table'), coalesce(x.filters, '[]'), coalesce(x.sorts, '[]'),
           coalesce(x.hidden_properties, '[]'), coalesce(x.property_order, '[]'), x.group_by, null
    from jsonb_to_recordset(coalesce(p_edit->'new_views', '[]')) as x(id uuid, database_id uuid, name text, type text,
      filters jsonb, sorts jsonb, hidden_properties jsonb, property_order jsonb, group_by uuid);

  -- A relation links only rows of its related database, in this workspace.
  if exists (select 1 from jsonb_to_recordset(coalesce(p_edit->'values', '[]')) as x(record_id uuid, property_id uuid, value jsonb)
               join public.database_properties p on p.id = x.property_id and p.workspace_id = ws and p.type = 'relation'
               where x.value is not null and x.value <> 'null'::jsonb
                 and (jsonb_typeof(x.value) <> 'array'
                      or exists (select 1 from jsonb_array_elements_text(x.value) e
                                 where not exists (select 1 from public.database_records r
                                   where r.id::text = e and r.workspace_id = ws
                                     and r.database_id::text = p.config->>'related_database_id')))) then
    raise exception 'Linked rows must be in the related database' using errcode = '42501';
  end if;
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
  -- Relations are links (record_relations), as the app saves them: a row's links for a
  -- relation are replaced by the ones sent.
  delete from public.record_relations rr
    using jsonb_to_recordset(coalesce(p_edit->'values', '[]')) as x(record_id uuid, property_id uuid, value jsonb)
    where rr.from_record_id = x.record_id and rr.property_id = x.property_id and rr.workspace_id = ws;
  insert into public.record_relations(from_record_id, property_id, database_id, workspace_id, to_record_id)
    select r.id, p.id, r.database_id, ws, linked.value::uuid
    from jsonb_to_recordset(coalesce(p_edit->'values', '[]')) as x(record_id uuid, property_id uuid, value jsonb)
    join public.database_records r on r.id = x.record_id and r.workspace_id = ws
    join public.database_properties p on p.id = x.property_id and p.database_id = r.database_id and p.type = 'relation'
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(x.value) = 'array' then x.value else '[]'::jsonb end) linked
    on conflict do nothing;
  -- Links an earlier version stored as plain values are dropped (the links above replace them).
  delete from public.record_values v using public.database_properties p
    where v.property_id = p.id and p.type = 'relation' and v.workspace_id = ws;
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
