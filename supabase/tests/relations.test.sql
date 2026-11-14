begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(4);
insert into auth.users(id,email) values('a0000000-0000-4000-8000-000000000003','relations@example.test');
create temporary table test_workspace as select id from public.workspaces where owner_id='a0000000-0000-4000-8000-000000000003';
grant select on test_workspace to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
insert into public.pages(id,workspace_id,title,parent_id) values
 ('c0000000-0000-4000-8000-000000000001',(select id from test_workspace),'Projects',null),
 ('c0000000-0000-4000-8000-000000000002',(select id from test_workspace),'Resources',null),
 ('c0000000-0000-4000-8000-000000000003',(select id from test_workspace),'Project A','c0000000-0000-4000-8000-000000000001'),
 ('c0000000-0000-4000-8000-000000000004',(select id from test_workspace),'Server A','c0000000-0000-4000-8000-000000000002');
insert into public.databases(id,workspace_id,page_id,name) values
 ('b0000000-0000-4000-8000-000000000001',(select id from test_workspace),'c0000000-0000-4000-8000-000000000001','Projects'),
 ('b0000000-0000-4000-8000-000000000002',(select id from test_workspace),'c0000000-0000-4000-8000-000000000002','Resources');
insert into public.database_properties(id,workspace_id,database_id,name,type,config) values
 ('d0000000-0000-4000-8000-000000000003',(select id from test_workspace),'b0000000-0000-4000-8000-000000000002','Project','relation','{"related_database_id":"b0000000-0000-4000-8000-000000000001"}');
insert into public.database_records(id,workspace_id,database_id,page_id) values
 ('e0000000-0000-4000-8000-000000000001',(select id from test_workspace),'b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003'),
 ('e0000000-0000-4000-8000-000000000002',(select id from test_workspace),'b0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000004');
set constraints all immediate;
insert into public.record_relations(from_record_id,property_id,database_id,workspace_id,to_record_id) values
 ('e0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002',(select id from test_workspace),'e0000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.record_relations),1,'A relation links records across databases in its workspace');
select throws_ok($$insert into public.record_relations(from_record_id,property_id,database_id,workspace_id,to_record_id) values('e0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002',(select id from test_workspace),'e0000000-0000-4000-8000-000000000002')$$,'P0001','Relation target must belong to the configured database.','Relation rejects a record from the wrong target database');
delete from public.database_records where id='e0000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.record_relations),0,'Deleting a target record cascades links without orphans');
select throws_ok($$update public.pages set parent_id='c0000000-0000-4000-8000-000000000004' where id='c0000000-0000-4000-8000-000000000002'$$,'P0001','A page cannot be moved inside itself or one of its descendants.','Moving a page into its descendant is rejected');
select * from finish();
rollback;
