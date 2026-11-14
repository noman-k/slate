begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);

insert into auth.users(id, email, raw_user_meta_data) values
 ('d0000000-0000-4000-8000-000000000001', 'edit-owner@example.test', '{}'),
 ('d0000000-0000-4000-8000-000000000002', 'edit-other@example.test', '{}');
create temporary table ws as
  select (select id from public.workspaces where owner_id = 'd0000000-0000-4000-8000-000000000001') as mine,
         (select id from public.workspaces where owner_id = 'd0000000-0000-4000-8000-000000000002') as theirs;
insert into public.agent_keys(owner_id, workspace_id, name, key_hash, key_prefix, scope)
  select 'd0000000-0000-4000-8000-000000000001', (select mine from ws), k.name, repeat(k.c, 64), 'slate_' || k.c || k.c, k.scope
  from (values ('Maker', 'a', 'write'), ('Editor', 'b', 'edit')) as k(name, c, scope);

-- A page with text, and a database with one row, made by the editing key.
select lives_ok($$select public.agent_create(repeat('b', 64), jsonb_build_object(
  'pages', jsonb_build_array(
    jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000001', 'workspace_id', (select mine from ws), 'title', 'Notes', 'kind', 'document', 'position', 0),
    jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000002', 'workspace_id', (select mine from ws), 'title', 'Tasks', 'kind', 'database',
      'database_id', 'd1000000-0000-4000-8000-000000000003', 'position', 1),
    jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000004', 'workspace_id', (select mine from ws), 'parent_id', 'd1000000-0000-4000-8000-000000000002',
      'title', 'Paint', 'kind', 'document', 'position', 0)),
  'documents', jsonb_build_array(jsonb_build_object('page_id', 'd1000000-0000-4000-8000-000000000001', 'markdown', 'Hello')),
  'databases', jsonb_build_array(jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000003', 'workspace_id', (select mine from ws),
    'page_id', 'd1000000-0000-4000-8000-000000000002', 'name', 'Tasks')),
  'properties', jsonb_build_array(
    jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000005', 'database_id', 'd1000000-0000-4000-8000-000000000003', 'name', 'Name', 'type', 'title', 'position', 0),
    jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000006', 'database_id', 'd1000000-0000-4000-8000-000000000003', 'name', 'Done', 'type', 'checkbox', 'position', 1)),
  'records', jsonb_build_array(jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000007', 'database_id', 'd1000000-0000-4000-8000-000000000003',
    'page_id', 'd1000000-0000-4000-8000-000000000004', 'position', 0, 'values', jsonb_build_object('d1000000-0000-4000-8000-000000000005', 'Paint')))))$$,
  'An editing key can also create');
create temporary table seen as select updated_at from public.documents where page_id = 'd1000000-0000-4000-8000-000000000001';
create function pg_temp.text_edit(markdown text, expected timestamptz) returns jsonb language sql as $$
  select jsonb_build_object('documents', jsonb_build_array(jsonb_build_object(
    'page_id', 'd1000000-0000-4000-8000-000000000001', 'markdown', markdown, 'expected_updated_at', expected)));
$$;

select throws_ok($$select public.agent_update(repeat('a', 64), pg_temp.text_edit('Nope', (select updated_at from seen)))$$,
  '42501', 'This agent key can''t edit', 'A key that may only create can''t edit');
select throws_ok($$select public.agent_update(repeat('b', 64), jsonb_build_object('pages', jsonb_build_array(jsonb_build_object(
    'id', (select id from public.pages where workspace_id = (select theirs from ws) limit 1), 'title', 'Mine now'))))$$,
  '42501', null, 'Nobody else''s pages can be edited');
select throws_ok($$select public.agent_update(repeat('b', 64), pg_temp.text_edit('Too late', now() - interval '1 day'))$$,
  '40001', null, 'Text that changed since it was read isn''t overwritten');
select lives_ok($$select public.agent_update(repeat('b', 64), pg_temp.text_edit('Hello again', (select updated_at from seen))
  || jsonb_build_object('pages', jsonb_build_array(jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000001', 'title', 'Notes, edited'))))$$,
  'Text and title change when it is unchanged since it was read');
select is((select markdown from public.documents where page_id = 'd1000000-0000-4000-8000-000000000001'), 'Hello again', 'The text changed');
select is((select title from public.pages where id = 'd1000000-0000-4000-8000-000000000001'), 'Notes, edited', 'The title changed');

-- Rows: a value set, a value cleared, a new column with a new row.
select lives_ok($$select public.agent_update(repeat('b', 64), jsonb_build_object(
  'values', jsonb_build_array(
    jsonb_build_object('record_id', 'd1000000-0000-4000-8000-000000000007', 'property_id', 'd1000000-0000-4000-8000-000000000006', 'value', true)),
  'new_properties', jsonb_build_array(jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000008', 'database_id', 'd1000000-0000-4000-8000-000000000003',
    'name', 'Notes', 'type', 'text', 'position', 2)),
  'new_pages', jsonb_build_array(jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000009', 'parent_id', 'd1000000-0000-4000-8000-000000000002', 'title', 'Sand', 'position', 1)),
  'new_documents', jsonb_build_array(jsonb_build_object('page_id', 'd1000000-0000-4000-8000-000000000009', 'markdown', '')),
  'new_records', jsonb_build_array(jsonb_build_object('id', 'd1000000-0000-4000-8000-00000000000a', 'database_id', 'd1000000-0000-4000-8000-000000000003',
    'page_id', 'd1000000-0000-4000-8000-000000000009', 'position', 1))))$$, 'Rows and columns can be added and changed');
select is((select value from public.record_values where record_id = 'd1000000-0000-4000-8000-000000000007' and property_id = 'd1000000-0000-4000-8000-000000000006'),
  'true'::jsonb, 'A value is set');
select is((select count(*)::integer from public.database_records where database_id = 'd1000000-0000-4000-8000-000000000003'), 2, 'A row is added');
select lives_ok($$select public.agent_update(repeat('b', 64), jsonb_build_object('values', jsonb_build_array(jsonb_build_object(
    'record_id', 'd1000000-0000-4000-8000-000000000007', 'property_id', 'd1000000-0000-4000-8000-000000000006', 'value', null))))$$, 'A value can be cleared');
select is((select count(*)::integer from public.record_values where record_id = 'd1000000-0000-4000-8000-000000000007'
  and property_id = 'd1000000-0000-4000-8000-000000000006'), 0, '…and is gone');

-- Trash, never gone.
select public.agent_update(repeat('b', 64), jsonb_build_object('pages', jsonb_build_array(jsonb_build_object('id', 'd1000000-0000-4000-8000-000000000001', 'trash', true))));
select ok((select deleted_at is not null from public.pages where id = 'd1000000-0000-4000-8000-000000000001'), 'Trashing keeps the page, in the Trash');

select * from finish();
rollback;
