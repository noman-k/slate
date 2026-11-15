begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

insert into auth.users(id, email, raw_user_meta_data) values
 ('e0000000-0000-4000-8000-000000000001', 'mover@example.test', '{}'),
 ('e0000000-0000-4000-8000-000000000002', 'someone@example.test', '{}');
create temporary table ws as
  select (select id from public.workspaces where owner_id = 'e0000000-0000-4000-8000-000000000001') as home,
         'e1000000-0000-4000-8000-0000000000aa'::uuid as work,
         (select id from public.workspaces where owner_id = 'e0000000-0000-4000-8000-000000000002') as theirs;
grant select on ws to authenticated;
insert into public.workspaces(id, owner_id, name) values ((select work from ws), 'e0000000-0000-4000-8000-000000000001', 'Work');

-- In Home: "Projects" (a page) holding a "Tasks" database with one row and an image, and a
-- "Notes" page left behind with a "People" database that Tasks links to.
set constraints all deferred;
insert into public.pages(id, workspace_id, parent_id, title, icon, kind, database_id, description, position, favorite) values
  ('e1000000-0000-4000-8000-000000000001', (select home from ws), null, 'Projects', '', 'document', null, '', 0, false),
  ('e1000000-0000-4000-8000-000000000002', (select home from ws), 'e1000000-0000-4000-8000-000000000001', 'Tasks', '', 'database', 'e1000000-0000-4000-8000-000000000003', '', 0, false),
  ('e1000000-0000-4000-8000-000000000004', (select home from ws), 'e1000000-0000-4000-8000-000000000002', 'Paint', '', 'document', null, '', 0, false),
  ('e1000000-0000-4000-8000-000000000010', (select home from ws), null, 'People', '', 'database', 'e1000000-0000-4000-8000-000000000011', '', 1, false),
  ('e1000000-0000-4000-8000-000000000012', (select home from ws), 'e1000000-0000-4000-8000-000000000010', 'Sam', '', 'document', null, '', 0, false);
insert into public.documents(page_id, workspace_id, markdown) values
  ('e1000000-0000-4000-8000-000000000001', (select home from ws), 'Plans'),
  ('e1000000-0000-4000-8000-000000000004', (select home from ws), '');
insert into public.databases(id, workspace_id, page_id, name) values
  ('e1000000-0000-4000-8000-000000000003', (select home from ws), 'e1000000-0000-4000-8000-000000000002', 'Tasks'),
  ('e1000000-0000-4000-8000-000000000011', (select home from ws), 'e1000000-0000-4000-8000-000000000010', 'People');
insert into public.database_properties(id, workspace_id, database_id, name, type, position, width, config) values
  ('e1000000-0000-4000-8000-000000000005', (select home from ws), 'e1000000-0000-4000-8000-000000000003', 'Name', 'title', 0, 200, '{}'),
  ('e1000000-0000-4000-8000-000000000006', (select home from ws), 'e1000000-0000-4000-8000-000000000003', 'Owner', 'relation', 1, 200,
    '{"related_database_id": "e1000000-0000-4000-8000-000000000011"}'),
  ('e1000000-0000-4000-8000-000000000013', (select home from ws), 'e1000000-0000-4000-8000-000000000011', 'Name', 'title', 0, 200, '{}');
insert into public.database_records(id, workspace_id, database_id, page_id, position) values
  ('e1000000-0000-4000-8000-000000000007', (select home from ws), 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004', 0),
  ('e1000000-0000-4000-8000-000000000014', (select home from ws), 'e1000000-0000-4000-8000-000000000011', 'e1000000-0000-4000-8000-000000000012', 0);
insert into public.record_values(record_id, property_id, database_id, workspace_id, value) values
  ('e1000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000003', (select home from ws), '"Paint"');
insert into public.record_relations(from_record_id, property_id, database_id, workspace_id, to_record_id) values
  ('e1000000-0000-4000-8000-000000000007', 'e1000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000003', (select home from ws), 'e1000000-0000-4000-8000-000000000014');
insert into public.database_views(id, workspace_id, database_id, name, type) values
  ('e1000000-0000-4000-8000-000000000008', (select home from ws), 'e1000000-0000-4000-8000-000000000003', 'Table', 'table');
insert into public.attachments(id, workspace_id, page_id, storage_path, name) values
  ('e1000000-0000-4000-8000-000000000009', (select home from ws), 'e1000000-0000-4000-8000-000000000001',
   (select home from ws)::text || '/e1000000-0000-4000-8000-000000000001/sketch.png', 'sketch.png');
set constraints all immediate;

set local role authenticated;
set local request.jwt.claims to '{"sub": "e0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select throws_ok($$select public.move_to_workspace('e1000000-0000-4000-8000-000000000004', (select work from ws))$$,
  '22023', 'A database row moves with its database', 'A row on its own can''t move');
select throws_ok($$select public.move_to_workspace('e1000000-0000-4000-8000-000000000001', (select theirs from ws))$$,
  '42501', 'Workspace not found', 'Nothing moves into someone else''s workspace');
select throws_ok($$select public.move_to_workspace('e1000000-0000-4000-8000-000000000001', (select work from ws), 'e1000000-0000-4000-8000-000000000010')$$,
  '22023', null, 'The new parent must be in the workspace it moves to');
select throws_ok($$select public.move_to_workspace('e1000000-0000-4000-8000-000000000001', (select home from ws))$$,
  '22023', null, 'Moving to where it is already is refused');

select lives_ok($$select public.move_to_workspace('e1000000-0000-4000-8000-000000000001', (select work from ws))$$,
  'A page with a database inside moves to another workspace');
select is((select count(*)::int from public.pages where workspace_id = (select work from ws)), 3, 'The page, its database and its row moved');
select is((select parent_id from public.pages where id = 'e1000000-0000-4000-8000-000000000001'), null, 'It sits at the top level there');
select is((select workspace_id from public.documents where page_id = 'e1000000-0000-4000-8000-000000000001'), (select work from ws), 'Its text moved');
select is((select workspace_id from public.databases where id = 'e1000000-0000-4000-8000-000000000003'), (select work from ws), 'The database moved');
select is((select count(*)::int from public.database_properties where database_id = 'e1000000-0000-4000-8000-000000000003' and workspace_id = (select work from ws)), 2, 'Its columns moved');
select is((select workspace_id from public.record_values where record_id = 'e1000000-0000-4000-8000-000000000007'), (select work from ws), 'Its values moved');
select is((select workspace_id from public.database_views where id = 'e1000000-0000-4000-8000-000000000008'), (select work from ws), 'Its views moved');
select is((select count(*)::int from public.record_relations where property_id = 'e1000000-0000-4000-8000-000000000006'), 0,
  'Links to a database left behind are removed');
select ok((select not (config ? 'related_database_id') from public.database_properties where id = 'e1000000-0000-4000-8000-000000000006'),
  'The relation column stays, pointing nowhere');
select is((select storage_path from public.attachments where id = 'e1000000-0000-4000-8000-000000000009'),
  (select work from ws)::text || '/e1000000-0000-4000-8000-000000000001/sketch.png', 'Its file is recorded at its new place');
select is((select workspace_id from public.pages where id = 'e1000000-0000-4000-8000-000000000010'), (select home from ws), 'Pages left behind stay');

select * from finish();
rollback;
