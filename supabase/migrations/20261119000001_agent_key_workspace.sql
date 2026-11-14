-- Each agent key belongs to one workspace. An agent sees and creates only in that
-- workspace, never the owner's others, and a key goes away with its workspace.
--
-- Keys made before this belong to their owner's current workspace (or, failing that,
-- their first one).
alter table public.agent_keys
  add column workspace_id uuid references public.workspaces(id) on delete cascade;
update public.agent_keys k set workspace_id = coalesce(
  (select w.id from public.profiles p join public.workspaces w on w.id = p.active_workspace_id and w.owner_id = k.owner_id
    where p.id = k.owner_id),
  (select w.id from public.workspaces w where w.owner_id = k.owner_id order by w.created_at limit 1));
delete from public.agent_keys where workspace_id is null;
alter table public.agent_keys alter column workspace_id set not null;
create index agent_keys_workspace on public.agent_keys(workspace_id);

grant select (workspace_id) on public.agent_keys to authenticated;
grant insert (workspace_id) on public.agent_keys to authenticated;
-- A key can only be made for one of your own workspaces.
drop policy agent_keys_owner_insert on public.agent_keys;
create policy agent_keys_owner_insert on public.agent_keys for insert to authenticated
  with check (
    owner_id = auth.uid() and revoked_at is null and last_used_at is null
    and exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
  );

create or replace function public.agent_workspace_state(p_key_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  key_id uuid;
  key_owner uuid;
  key_name text;
  key_scope text;
  key_workspace uuid;
  ws uuid[];
  result jsonb;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  select id, owner_id, name, scope, workspace_id into key_id, key_owner, key_name, key_scope, key_workspace
    from public.agent_keys where key_hash = p_key_hash and revoked_at is null;
  if key_owner is null then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  -- "Last used", at most once a minute.
  update public.agent_keys set last_used_at = now()
    where id = key_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  -- Only the key's own workspace (and only while its owner still owns it).
  select coalesce(array_agg(id), '{}') into ws from public.workspaces where id = key_workspace and owner_id = key_owner;
  select jsonb_build_object(
    -- Which key this is and what it may do, so the server can offer the right tools.
    'agent', jsonb_build_object('name', key_name, 'scope', key_scope),
    'revision', (select sync_revision from public.profiles where id = key_owner),
    'active_workspace_id', key_workspace,
    'workspaces', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'owner_id', owner_id) order by created_at)
      from public.workspaces where id = any(ws)), '[]'),
    'pages', coalesce((select jsonb_agg(to_jsonb(p) order by position) from public.pages p where p.workspace_id = any(ws)), '[]'),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) - 'workspace_id') from public.documents d where d.workspace_id = any(ws)), '[]'),
    'databases', coalesce((select jsonb_agg(to_jsonb(d) - 'created_at' - 'updated_at') from public.databases d where d.workspace_id = any(ws)), '[]'),
    'properties', coalesce((select jsonb_agg(to_jsonb(p) - 'workspace_id' order by position) from public.database_properties p where p.workspace_id = any(ws)), '[]'),
    'views', coalesce((select jsonb_agg(to_jsonb(v) - 'workspace_id') from public.database_views v where v.workspace_id = any(ws)), '[]'),
    'records', coalesce((select jsonb_agg((to_jsonb(r) - 'workspace_id') || jsonb_build_object('values',
      coalesce((select jsonb_object_agg(v.property_id::text, v.value) from public.record_values v where v.record_id = r.id), '{}') ||
      coalesce((select jsonb_object_agg(a.property_id::text, a.ids) from (
        select rr.property_id, jsonb_agg(rr.to_record_id order by rr.to_record_id) as ids
        from public.record_relations rr where rr.from_record_id = r.id group by rr.property_id) a), '{}')
    ) order by r.position) from public.database_records r where r.workspace_id = any(ws)), '[]')
  ) into result;
  return result;
end $$;

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
    from public.agent_keys where key_hash = p_key_hash and revoked_at is null;
  if key_owner is null then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  if key_scope <> 'write' then
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
