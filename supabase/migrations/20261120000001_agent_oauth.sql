-- Connecting an app with OAuth: instead of pasting a key, people add Slate's MCP address
-- to Claude, ChatGPT, Codex or another app, sign in to Slate, choose a workspace and what
-- the app may do, and allow it. The app gets short-lived access tokens (and a refresh
-- token) instead of a key.
--
-- Each connection is an agent_keys row (client_id set, its key_hash a random value nobody
-- holds), so it shows in Settings › AI agents, belongs to one workspace, has a scope, and
-- stops working the moment it's revoked. Codes and tokens are stored only as SHA-256
-- hashes. Apps register themselves (Dynamic Client Registration) and are public clients:
-- PKCE (S256) protects the code exchange.

alter table public.agent_keys add column client_id text;
grant select (client_id) on public.agent_keys to authenticated;

-- Apps that registered to connect. Nobody reads these through the API directly.
create table public.oauth_clients (
  id text primary key,
  name text not null check (char_length(name) between 1 and 100),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at timestamptz not null default now()
);
alter table public.oauth_clients enable row level security;
revoke all on table public.oauth_clients from anon, authenticated;

-- A code is handed to the app once someone allows it, and swapped for tokens within minutes.
create table public.oauth_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  client_id text not null references public.oauth_clients(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope text not null check (scope in ('read', 'write')),
  redirect_uri text not null,
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz not null default now() + interval '5 minutes'
);
alter table public.oauth_codes enable row level security;
revoke all on table public.oauth_codes from anon, authenticated;

-- The current tokens for a connection: an access token that lasts an hour, and a refresh
-- token that's replaced each time it's used.
create table public.oauth_tokens (
  key_id uuid primary key references public.agent_keys(id) on delete cascade,
  access_hash text not null unique check (access_hash ~ '^[0-9a-f]{64}$'),
  refresh_hash text not null unique check (refresh_hash ~ '^[0-9a-f]{64}$'),
  access_expires_at timestamptz not null
);
alter table public.oauth_tokens enable row level security;
revoke all on table public.oauth_tokens from anon, authenticated;

-- The live agent key (or connection) a bearer secret belongs to: an agent key, or a
-- connection's unexpired access token. Used only inside the agent functions.
create function public.agent_key_id(p_hash text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.agent_keys where key_hash = p_hash and revoked_at is null and client_id is null
  union all
  select k.id from public.oauth_tokens t join public.agent_keys k on k.id = t.key_id
    where t.access_hash = p_hash and t.access_expires_at > now() and k.revoked_at is null
  limit 1;
$$;
revoke all on function public.agent_key_id(text) from public, anon, authenticated;

-- Registration: any app may register (the endpoint is rate limited). Returns its client id.
create function public.oauth_register_client(p_name text, p_redirect_uris text[]) returns text
language plpgsql security definer set search_path = public as $$
declare new_id text := 'slate_client_' || replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.oauth_clients(id, name, redirect_uris)
    values (new_id, left(coalesce(nullif(btrim(p_name), ''), 'An AI app'), 100), p_redirect_uris);
  return new_id;
end $$;

-- What the consent page shows about an app: its name and where it may be sent back to.
create function public.oauth_client(p_client_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'redirect_uris', to_jsonb(redirect_uris))
  from public.oauth_clients where id = p_client_id;
$$;

-- Someone signed in allowed an app into one of their workspaces: keep a code for it.
create function public.oauth_authorize(p_client_id text, p_redirect_uri text, p_workspace_id uuid, p_scope text,
  p_code_challenge text, p_code_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id and owner_id = auth.uid()) then
    raise exception 'Not your workspace' using errcode = '42501';
  end if;
  if not exists (select 1 from public.oauth_clients where id = p_client_id and p_redirect_uri = any(redirect_uris)) then
    raise exception 'Unknown app or return address' using errcode = '22023';
  end if;
  delete from public.oauth_codes where expires_at < now();
  insert into public.oauth_codes(code_hash, client_id, owner_id, workspace_id, scope, redirect_uri, code_challenge)
    values (p_code_hash, p_client_id, auth.uid(), p_workspace_id, p_scope, p_redirect_uri, p_code_challenge);
end $$;

-- The app swaps its code (once) for tokens, proving with the PKCE verifier that it's the
-- app that asked. The connection appears in the workspace's Settings › AI agents.
-- Returns { scope, expires_in }, or { error: 'invalid_grant' }.
create function public.oauth_exchange_code(p_code_hash text, p_client_id text, p_redirect_uri text, p_code_verifier text,
  p_access_hash text, p_refresh_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  code public.oauth_codes;
  app_name text;
  new_key uuid;
begin
  -- Used up whether or not the rest checks out: a code is good for one try. (So a bad
  -- try returns an error rather than raising one, which would undo the delete.)
  delete from public.oauth_codes where code_hash = p_code_hash returning * into code;
  if code.code_hash is null or code.expires_at < now() or code.client_id <> p_client_id
     or code.redirect_uri <> p_redirect_uri
     or coalesce(p_code_verifier, '') !~ '^[A-Za-z0-9._~-]{43,128}$'
     or translate(rtrim(encode(sha256(convert_to(p_code_verifier, 'UTF8')), 'base64'), '='), '+/', '-_') <> code.code_challenge
     or not exists (select 1 from public.workspaces where id = code.workspace_id and owner_id = code.owner_id) then
    return jsonb_build_object('error', 'invalid_grant');
  end if;
  select name into app_name from public.oauth_clients where id = code.client_id;
  insert into public.agent_keys(owner_id, workspace_id, name, key_hash, key_prefix, scope, client_id)
    values (code.owner_id, code.workspace_id, left(app_name, 80),
            encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
            'oauth', code.scope, code.client_id)
    returning id into new_key;
  insert into public.oauth_tokens(key_id, access_hash, refresh_hash, access_expires_at)
    values (new_key, p_access_hash, p_refresh_hash, now() + interval '1 hour');
  return jsonb_build_object('scope', code.scope, 'expires_in', 3600);
end $$;

-- A new access token for a refresh token, which is replaced too. Fails once the
-- connection is revoked.
create function public.oauth_refresh(p_refresh_hash text, p_client_id text, p_access_hash text, p_new_refresh_hash text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare key_scope text;
begin
  update public.oauth_tokens t
    set access_hash = p_access_hash, refresh_hash = p_new_refresh_hash, access_expires_at = now() + interval '1 hour'
    from public.agent_keys k
    where t.refresh_hash = p_refresh_hash and k.id = t.key_id and k.revoked_at is null and k.client_id = p_client_id
    returning k.scope into key_scope;
  if key_scope is null then
    raise exception 'invalid_grant' using errcode = '22023';
  end if;
  return jsonb_build_object('scope', key_scope, 'expires_in', 3600);
end $$;

revoke all on function public.oauth_register_client(text, text[]) from public;
revoke all on function public.oauth_client(text) from public;
revoke all on function public.oauth_authorize(text, text, uuid, text, text, text) from public;
revoke all on function public.oauth_exchange_code(text, text, text, text, text, text) from public;
revoke all on function public.oauth_refresh(text, text, text, text) from public;
grant execute on function public.oauth_register_client(text, text[]) to anon, authenticated;
grant execute on function public.oauth_client(text) to anon, authenticated;
grant execute on function public.oauth_authorize(text, text, uuid, text, text, text) to authenticated;
grant execute on function public.oauth_exchange_code(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.oauth_refresh(text, text, text, text) to anon, authenticated;

-- The agent functions accept a connection's access token as well as an agent key.
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
    from public.agent_keys where id = public.agent_key_id(p_key_hash);
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
    from public.agent_keys where id = public.agent_key_id(p_key_hash);
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
