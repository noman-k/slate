begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

insert into auth.users(id, email, raw_user_meta_data) values
 ('c0000000-0000-4000-8000-000000000001', 'oauth-owner@example.test', '{}'),
 ('c0000000-0000-4000-8000-000000000002', 'oauth-other@example.test', '{}');
create temporary table ws as
  select (select id from public.workspaces where owner_id = 'c0000000-0000-4000-8000-000000000001') as mine,
         (select id from public.workspaces where owner_id = 'c0000000-0000-4000-8000-000000000002') as theirs;
grant select on ws to authenticated;

-- PKCE: a verifier and its S256 challenge.
create temporary table pkce as select 'dBjftJeZ4CVP-mB92K27uhbUpztY2wOm3qEWQgBpFW1gFWFOEjXk'::text as verifier,
  'lM256Y9dUZHNg6TRyZZFhtYdGB-w6GMbEvlKDOsu4AA'::text as challenge;
grant select on pkce to authenticated;

create temporary table app as select public.oauth_register_client('Test app', array['https://app.example.test/callback']) as id;
grant select on app to authenticated;
select ok((select id from app) like 'slate_client_%', 'An app registers and gets a client id');
select is(public.oauth_client((select id from app)) ->> 'name', 'Test app', 'The consent page can name the app');

-- Signed in as the owner, allowing the app.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.oauth_authorize((select id from app), 'https://evil.example.test/callback', (select mine from ws), 'write',
    (select challenge from pkce), repeat('1', 64))$$, '22023', null, 'Only a return address the app registered is accepted');
select throws_ok($$select public.oauth_authorize((select id from app), 'https://app.example.test/callback', (select theirs from ws), 'write',
    (select challenge from pkce), repeat('1', 64))$$, '42501', null, 'Nobody can allow an app into someone else''s workspace');
select lives_ok($$select public.oauth_authorize((select id from app), 'https://app.example.test/callback', (select mine from ws), 'write',
    (select challenge from pkce), repeat('1', 64))$$, 'The owner allows the app into their workspace');
select lives_ok($$select public.oauth_authorize((select id from app), 'https://app.example.test/callback', (select mine from ws), 'read',
    (select challenge from pkce), repeat('2', 64))$$, 'A second code, for checking a wrong verifier');
reset role;
select is((select count(*)::integer from public.agent_keys where client_id = (select id from app)), 0, 'Nothing is connected until the app swaps its code');

-- The app swaps the code.
select is(public.oauth_exchange_code(repeat('2', 64), (select id from app), 'https://app.example.test/callback',
    'wrong-verifier-wrong-verifier-wrong-verifier-123', repeat('a', 64), repeat('b', 64)) ->> 'error', 'invalid_grant', 'A wrong PKCE verifier is refused');
select is(public.oauth_exchange_code(repeat('2', 64), (select id from app), 'https://app.example.test/callback',
    (select verifier from pkce), repeat('a', 64), repeat('b', 64)) ->> 'error', 'invalid_grant', '…and that code is used up');
select is(public.oauth_exchange_code(repeat('1', 64), (select id from app), 'https://app.example.test/callback',
    (select verifier from pkce), repeat('a', 64), repeat('b', 64)) ->> 'scope', 'write', 'The right verifier gets tokens, with the scope allowed');
select is(public.oauth_exchange_code(repeat('1', 64), (select id from app), 'https://app.example.test/callback',
    (select verifier from pkce), repeat('c', 64), repeat('d', 64)) ->> 'error', 'invalid_grant', 'A code works once');

-- The access token works like a key, for its workspace only.
select is(public.agent_workspace_state(repeat('a', 64)) ->> 'active_workspace_id', (select mine from ws)::text, 'The access token opens the chosen workspace');
select is(public.agent_workspace_state(repeat('a', 64)) -> 'agent' ->> 'name', 'Test app', 'The connection is named after the app');

-- Refreshing replaces both tokens.
select is(public.oauth_refresh(repeat('b', 64), (select id from app), repeat('e', 64), repeat('f', 64)) ->> 'scope', 'write', 'A refresh token gets new tokens');
select throws_ok($$select public.agent_workspace_state(repeat('a', 64))$$, '28000', null, 'The old access token stops working');
select throws_ok($$select public.oauth_refresh(repeat('b', 64), (select id from app), repeat('1', 64), repeat('2', 64))$$,
  '22023', 'invalid_grant', 'The old refresh token stops working');

-- Expired, then revoked.
update public.oauth_tokens set access_expires_at = now() - interval '1 second' where access_hash = repeat('e', 64);
select throws_ok($$select public.agent_workspace_state(repeat('e', 64))$$, '28000', null, 'An expired access token is refused');
update public.agent_keys set revoked_at = now() where client_id = (select id from app);
select throws_ok($$select public.oauth_refresh(repeat('f', 64), (select id from app), repeat('3', 64), repeat('4', 64))$$,
  '22023', 'invalid_grant', 'A disconnected app can''t refresh');

select * from finish();
rollback;
