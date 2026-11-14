-- A linked database block (a database shown in a page it doesn't live in) has its own
-- views: filters, sorts and layout there don't change the original or other pages.
-- "placement" is that block's id; it's null for a database's own views.
alter table public.database_views add column placement text;
create index database_views_placement_idx on public.database_views(database_id, placement);

-- load_workspace_state returns every database_views column (to_jsonb(v)), so it picks
-- placement up as is. save_workspace_state needs to store it:
create or replace function public.save_workspace_state(p_state jsonb,p_expected_revision bigint) returns bigint language plpgsql security invoker set search_path=public as $$
declare current_revision bigint; next_revision bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select sync_revision into current_revision from public.profiles where id=auth.uid() for update;
  if current_revision is distinct from p_expected_revision then raise exception 'Sync conflict: reload before saving'; end if;
  if jsonb_typeof(p_state->'workspaces')<>'array' or jsonb_array_length(p_state->'workspaces')=0 then raise exception 'At least one workspace is required'; end if;
  set constraints all deferred;
  insert into public.workspaces(id,owner_id,name)
    select x.id,auth.uid(),x.name from jsonb_to_recordset(p_state->'workspaces') as x(id uuid,name text)
    on conflict(id) do update set name=excluded.name,updated_at=now();
  insert into public.pages(id,workspace_id,parent_id,title,icon,kind,database_id,description,position,favorite,deleted_at,created_at,updated_at)
    select x.id,x.workspace_id,x.parent_id,coalesce(x.title,'Untitled'),coalesce(x.icon,''),x.kind,x.database_id,coalesce(x.description,''),x.position,x.favorite,x.deleted_at,x.created_at,x.updated_at
    from jsonb_to_recordset(p_state->'pages') as x(id uuid,workspace_id uuid,parent_id uuid,title text,icon text,kind text,database_id uuid,description text,position double precision,favorite boolean,deleted_at timestamptz,created_at timestamptz,updated_at timestamptz)
    on conflict(id) do update set parent_id=excluded.parent_id,title=excluded.title,icon=excluded.icon,kind=excluded.kind,database_id=excluded.database_id,description=excluded.description,position=excluded.position,favorite=excluded.favorite,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at;
  insert into public.documents(page_id,workspace_id,markdown,content,updated_at)
    select x.page_id,p.workspace_id,x.markdown,x.content,x.updated_at from jsonb_to_recordset(p_state->'documents') as x(page_id uuid,markdown text,content jsonb,updated_at timestamptz) join public.pages p on p.id=x.page_id
    on conflict(page_id) do update set markdown=excluded.markdown,content=excluded.content,updated_at=excluded.updated_at;
  insert into public.databases(id,workspace_id,page_id,name,open_mode)
    select x.id,x.workspace_id,x.page_id,x.name,coalesce(x.open_mode,'peek') from jsonb_to_recordset(p_state->'databases') as x(id uuid,workspace_id uuid,page_id uuid,name text,open_mode text)
    on conflict(id) do update set name=excluded.name,open_mode=excluded.open_mode,updated_at=now();
  -- Clear type uniqueness conflicts before upserting changes, all within this transaction.
  delete from public.record_relations where public.owns_workspace(workspace_id);
  delete from public.record_values where public.owns_workspace(workspace_id);
  delete from public.database_views where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'views'));
  delete from public.database_properties where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'properties'));
  insert into public.database_properties(id,workspace_id,database_id,name,type,position,width,config)
    select x.id,d.workspace_id,x.database_id,x.name,x.type,x.position,x.width,coalesce(x.config,'{}') from jsonb_to_recordset(p_state->'properties') as x(id uuid,database_id uuid,name text,type text,position double precision,width integer,config jsonb) join public.databases d on d.id=x.database_id
    on conflict(id) do update set name=excluded.name,type=excluded.type,position=excluded.position,width=excluded.width,config=excluded.config;
  insert into public.database_records(id,workspace_id,database_id,page_id,position,created_at,updated_at)
    select x.id,d.workspace_id,x.database_id,x.page_id,x.position,x.created_at,x.updated_at from jsonb_to_recordset(p_state->'records') as x(id uuid,database_id uuid,page_id uuid,position double precision,created_at timestamptz,updated_at timestamptz) join public.databases d on d.id=x.database_id
    on conflict(id) do update set position=excluded.position,updated_at=excluded.updated_at;
  insert into public.record_values(record_id,property_id,database_id,workspace_id,value)
    select (r->>'id')::uuid,p.id,p.database_id,p.workspace_id,v.value from jsonb_array_elements(p_state->'records') r cross join lateral jsonb_each(r->'values') v join public.database_properties p on p.id=v.key::uuid and p.database_id=(r->>'database_id')::uuid where p.type<>'relation';
  insert into public.record_relations(from_record_id,property_id,database_id,workspace_id,to_record_id)
    select (r->>'id')::uuid,p.id,p.database_id,p.workspace_id,linked.value::uuid from jsonb_array_elements(p_state->'records') r cross join lateral jsonb_each(r->'values') v join public.database_properties p on p.id=v.key::uuid and p.database_id=(r->>'database_id')::uuid cross join lateral jsonb_array_elements_text(case when p.type='relation' and jsonb_typeof(v.value)='array' then v.value else '[]'::jsonb end) linked where p.type='relation' and exists(select 1 from jsonb_array_elements(p_state->'records') desired where desired->>'id'=linked.value);
  insert into public.database_views(id,workspace_id,database_id,name,type,filters,sorts,hidden_properties,property_order,group_by,placement)
    select x.id,d.workspace_id,x.database_id,x.name,x.type,coalesce(x.filters,'[]'),coalesce(x.sorts,'[]'),coalesce(x.hidden_properties,'[]'),coalesce(x.property_order,'[]'),x.group_by,nullif(x.placement,'') from jsonb_to_recordset(p_state->'views') as x(id uuid,database_id uuid,name text,type text,filters jsonb,sorts jsonb,hidden_properties jsonb,property_order jsonb,group_by uuid,placement text) join public.databases d on d.id=x.database_id
    on conflict(id) do update set name=excluded.name,type=excluded.type,filters=excluded.filters,sorts=excluded.sorts,hidden_properties=excluded.hidden_properties,property_order=excluded.property_order,group_by=excluded.group_by,placement=excluded.placement;
  delete from public.documents where page_id not in (select (value->>'page_id')::uuid from jsonb_array_elements(p_state->'documents'));
  delete from public.database_records where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'records'));
  delete from public.databases where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'databases'));
  delete from public.pages where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'pages'));
  delete from public.workspaces where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'workspaces'));
  if not public.owns_workspace((p_state->>'active_workspace_id')::uuid) then raise exception 'Invalid active workspace'; end if;
  update public.profiles set active_workspace_id=(p_state->>'active_workspace_id')::uuid,sync_revision=sync_revision+1,updated_at=now() where id=auth.uid() returning sync_revision into next_revision;
  return next_revision;
end $$;
