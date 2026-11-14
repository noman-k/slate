-- Agent keys: let an AI agent (over MCP) read a person's workspace, read-only.
--
-- A key is a random secret made in the browser; only its SHA-256 hash is stored here,
-- so the key itself is shown once and never kept. Keys can be revoked (revoked_at).
-- agent_workspace_state(hash) returns the same shape as load_workspace_state, limited to
-- the key owner's workspaces. It reads only: it never writes workspace data.

create table public.agent_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  -- The first characters of the key, so people can tell their keys apart.
  key_prefix text not null check (char_length(key_prefix) between 4 and 16),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index agent_keys_owner on public.agent_keys(owner_id);

alter table public.agent_keys enable row level security;
create policy agent_keys_owner_select on public.agent_keys for select to authenticated
  using (owner_id = auth.uid());
create policy agent_keys_owner_insert on public.agent_keys for insert to authenticated
  with check (owner_id = auth.uid() and revoked_at is null and last_used_at is null);
-- Updates only revoke a key: nothing else about it can change.
create policy agent_keys_owner_update on public.agent_keys for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and revoked_at is not null);

revoke all on table public.agent_keys from anon, authenticated;
grant select (id, name, key_prefix, created_at, last_used_at, revoked_at) on public.agent_keys to authenticated;
grant insert (name, key_hash, key_prefix) on public.agent_keys to authenticated;
grant update (revoked_at) on public.agent_keys to authenticated;

create function public.agent_workspace_state(p_key_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  key_id uuid;
  key_owner uuid;
  ws uuid[];
  result jsonb;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  select id, owner_id into key_id, key_owner
    from public.agent_keys where key_hash = p_key_hash and revoked_at is null;
  if key_owner is null then
    raise exception 'Invalid agent key' using errcode = '28000';
  end if;
  -- "Last used", at most once a minute.
  update public.agent_keys set last_used_at = now()
    where id = key_id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  select coalesce(array_agg(id), '{}') into ws from public.workspaces where owner_id = key_owner;
  select jsonb_build_object(
    'active_workspace_id', (select active_workspace_id from public.profiles where id = key_owner),
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

revoke all on function public.agent_workspace_state(text) from public;
grant execute on function public.agent_workspace_state(text) to anon, authenticated;
