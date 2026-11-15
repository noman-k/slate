-- Agents that can edit can also customize: page and database icons, how a database's rows
-- open, relation, formula and rollup columns (a relation can show on both databases), column
-- names, linked rows, and a database's views (layout, filters, sorts, columns shown, grouping).
--
-- p_edit, as before, plus:
--   pages:            [{ id, title?, description?, icon?, trash? }]   icon: "" or "icon:<name>:<color>"
--   databases:        [{ id, name?, open_mode? }]
--   property_names:   [{ id, name }]
--   property_configs, new_properties: configs may point at databases and properties (related
--                     database, the relation's other side, a rollup's relation and property);
--                     all must be in this workspace (or new in this edit)
--   views:            [{ id, name?, type?, filters?, sorts?, hidden_properties?, property_order?, group_by? }]
--   new_views:        [{ id, database_id, name, type, filters, sorts, hidden_properties, property_order, group_by? }]
--   values:           relation values are lists of rows of the related database
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
      and p.type not in ('rollup', 'formula', 'created_time', 'updated_time')
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
