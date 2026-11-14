begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(10);
insert into auth.users(id,email,raw_user_meta_data) values
 ('a0000000-0000-4000-8000-000000000001','owner-a@example.test','{"display_name":"Owner A"}'),
 ('a0000000-0000-4000-8000-000000000002','owner-b@example.test','{"display_name":"Owner B"}');
select is((select count(*)::integer from public.workspaces where owner_id in ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002')),2,'Registration creates one workspace per user');
select is((select display_name from public.profiles where id='a0000000-0000-4000-8000-000000000001'),'Owner A','Registration creates a profile');
create temporary table other_workspace as select id from public.workspaces where owner_id='a0000000-0000-4000-8000-000000000002';
grant select on other_workspace to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::integer from public.workspaces),1,'Workspace RLS only exposes the current owner');
select is((select count(*)::integer from public.profiles),1,'Profile RLS isolates accounts');
select is((select count(*)::integer from public.workspaces where id=(select id from other_workspace)),0,'A known foreign workspace UUID cannot be read');
select throws_ok($$insert into public.pages(workspace_id,title) values((select id from other_workspace),'Foreign page')$$,'42501',null,'Cannot insert a page in another account');
select throws_ok($$insert into public.workspaces(owner_id,name) values('a0000000-0000-4000-8000-000000000002','Impersonated')$$,'42501',null,'Cannot impersonate another workspace owner');
select is((public.load_workspace_state()->'state'->'workspaces'->0->>'owner_id'),'a0000000-0000-4000-8000-000000000001','Transport snapshot remains scoped by RLS');
select is(public.save_workspace_state(public.load_workspace_state()->'state',0),1::bigint,'Atomic transaction increments revision');
select throws_ok($$select public.save_workspace_state(public.load_workspace_state()->'state',0)$$,'P0001','Sync conflict: reload before saving','Stale tab cannot overwrite newer data');
select * from finish();
rollback;
