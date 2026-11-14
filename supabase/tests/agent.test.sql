begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(11);

insert into auth.users(id, email, raw_user_meta_data) values
 ('b0000000-0000-4000-8000-000000000001', 'agent-owner@example.test', '{}'),
 ('b0000000-0000-4000-8000-000000000002', 'someone-else@example.test', '{}');
-- Keys are stored as hashes; any 64 hex characters stand in for one here.
insert into public.agent_keys(owner_id, name, key_hash, key_prefix, scope) values
 ('b0000000-0000-4000-8000-000000000001', 'Reader', repeat('a', 64), 'slate_aa', 'read'),
 ('b0000000-0000-4000-8000-000000000001', 'Maker', repeat('b', 64), 'slate_bb', 'write');
insert into public.agent_keys(owner_id, name, key_hash, key_prefix, scope, revoked_at) values
 ('b0000000-0000-4000-8000-000000000001', 'Old', repeat('c', 64), 'slate_cc', 'write', now());
create temporary table ws as
  select (select id from public.workspaces where owner_id = 'b0000000-0000-4000-8000-000000000001') as mine,
         (select id from public.workspaces where owner_id = 'b0000000-0000-4000-8000-000000000002') as theirs;

select is(public.agent_workspace_state(repeat('b', 64)) -> 'agent' ->> 'scope', 'write', 'The workspace snapshot says what the key may do');
select is(public.agent_workspace_state(repeat('a', 64)) -> 'agent' ->> 'scope', 'read', 'Keys are read-only unless created otherwise');

create function pg_temp.page(workspace uuid, page uuid, title text) returns jsonb language sql as $$
  select jsonb_build_object('pages', jsonb_build_array(jsonb_build_object('id', page, 'workspace_id', workspace, 'title', title, 'kind', 'document', 'position', 0)),
                            'documents', jsonb_build_array(jsonb_build_object('page_id', page, 'markdown', 'Hello from an agent')));
$$;

select throws_ok($$select public.agent_create(repeat('a', 64), pg_temp.page((select mine from ws), 'b1000000-0000-4000-8000-000000000001', 'Nope'))$$,
  '42501', 'This agent key can only read', 'A read-only key cannot create');
select throws_ok($$select public.agent_create(repeat('c', 64), pg_temp.page((select mine from ws), 'b1000000-0000-4000-8000-000000000001', 'Nope'))$$,
  '28000', 'Invalid agent key', 'A revoked key cannot create');
select throws_ok($$select public.agent_create(repeat('b', 64), pg_temp.page((select theirs from ws), 'b1000000-0000-4000-8000-000000000001', 'Theirs'))$$,
  '42501', null, 'A key cannot create in someone else''s workspace');
select throws_ok($$select public.agent_create(repeat('b', 64), jsonb_build_object('appends', jsonb_build_array(jsonb_build_object(
    'page_id', (select id from public.pages where workspace_id = (select theirs from ws) limit 1), 'text', 'hi'))))$$,
  '42501', null, 'A key cannot add text to someone else''s page');
select throws_ok($$select public.agent_create(repeat('b', 64), jsonb_build_object('properties', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'database_id', gen_random_uuid(), 'name', 'X', 'type', 'text', 'position', 1))))$$,
  '42501', 'Only new databases can be filled in', 'A key cannot add to databases it did not create');

create temporary table before as select sync_revision from public.profiles where id = 'b0000000-0000-4000-8000-000000000001';
create temporary table hub as select id from public.pages where workspace_id = (select mine from ws) limit 1;
select lives_ok($$select public.agent_create(repeat('b', 64),
    pg_temp.page((select mine from ws), 'b1000000-0000-4000-8000-000000000002', 'Made by an agent')
    || jsonb_build_object('appends', jsonb_build_array(jsonb_build_object('page_id', (select id from hub), 'text', 'Linked below'))))$$,
  'A key that may create adds a page, and text to its owner''s page');
select is((select title from public.pages where id = 'b1000000-0000-4000-8000-000000000002'), 'Made by an agent', 'The page exists');
select ok((select markdown like '%Linked below' from public.documents where page_id = (select id from hub)), 'Text is appended, not replaced');
select is((select sync_revision from public.profiles where id = 'b0000000-0000-4000-8000-000000000001'),
  (select sync_revision + 1 from before), 'The revision moves on, so open tabs reload instead of saving over it');

select * from finish();
rollback;
