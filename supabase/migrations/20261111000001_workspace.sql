-- Slate: normalized, private workspaces. Application transactions run as the authenticated user.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  active_workspace_id uuid,
  sync_revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_owner_idx on public.workspaces(owner_id);
alter table public.profiles add constraint profiles_active_workspace_fk foreign key(active_workspace_id) references public.workspaces(id) on delete set null deferrable initially deferred;

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid,
  title text not null default 'Untitled' check(length(title) <= 2000),
  icon text not null default '',
  kind text not null default 'document' check(kind in ('document','database')),
  database_id uuid,
  description text not null default '',
  position double precision not null default 0,
  favorite boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, workspace_id),
  check(parent_id is distinct from id),
  foreign key(parent_id, workspace_id) references public.pages(id, workspace_id) on delete cascade deferrable initially deferred
);
create index pages_tree_idx on public.pages(workspace_id,parent_id,position) where deleted_at is null;
create index pages_trash_idx on public.pages(workspace_id,deleted_at) where deleted_at is not null;
create index pages_title_search_idx on public.pages using gin(to_tsvector('simple',title));
create table public.documents (
  page_id uuid primary key,
  workspace_id uuid not null,
  markdown text not null default '',
  content jsonb,
  updated_at timestamptz not null default now(),
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade deferrable initially deferred
);
create index documents_search_idx on public.documents using gin(to_tsvector('simple',markdown));
create table public.databases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  page_id uuid not null unique,
  name text not null default 'Untitled database',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,workspace_id),
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade deferrable initially deferred
);
alter table public.pages add constraint pages_database_fk foreign key(database_id,workspace_id) references public.databases(id,workspace_id) on delete set null (database_id) deferrable initially deferred;
create index databases_workspace_idx on public.databases(workspace_id);
create table public.database_properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  database_id uuid not null,
  name text not null,
  type text not null check(type in ('title','text','number','currency','checkbox','date','datetime','select','multi_select','status','url','email','phone','relation','rollup','formula','created_time','updated_time')),
  position double precision not null default 0,
  width integer not null default 180 check(width between 48 and 3000),
  config jsonb not null default '{}',
  unique(id,database_id,workspace_id),
  unique(id,workspace_id),
  foreign key(database_id,workspace_id) references public.databases(id,workspace_id) on delete cascade deferrable initially deferred
);
create index properties_database_idx on public.database_properties(database_id,position);
create unique index properties_one_title_idx on public.database_properties(database_id) where type='title';
create table public.database_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  database_id uuid not null,
  page_id uuid not null unique,
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,database_id,workspace_id),
  unique(id,workspace_id),
  foreign key(database_id,workspace_id) references public.databases(id,workspace_id) on delete cascade deferrable initially deferred,
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade deferrable initially deferred
);
create index records_database_idx on public.database_records(database_id,position,id);
create table public.record_values (
  record_id uuid not null,
  property_id uuid not null,
  database_id uuid not null,
  workspace_id uuid not null,
  value jsonb not null default 'null',
  primary key(record_id,property_id),
  foreign key(record_id,database_id,workspace_id) references public.database_records(id,database_id,workspace_id) on delete cascade deferrable initially deferred,
  foreign key(property_id,database_id,workspace_id) references public.database_properties(id,database_id,workspace_id) on delete cascade deferrable initially deferred
);
create index record_values_property_idx on public.record_values(property_id);
create table public.database_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  database_id uuid not null,
  name text not null,
  type text not null default 'table' check(type in ('table','list','board')),
  filters jsonb not null default '[]',
  sorts jsonb not null default '[]',
  hidden_properties jsonb not null default '[]',
  property_order jsonb not null default '[]',
  group_by uuid,
  foreign key(database_id,workspace_id) references public.databases(id,workspace_id) on delete cascade deferrable initially deferred,
  foreign key(group_by,workspace_id) references public.database_properties(id,workspace_id) on delete set null(group_by) deferrable initially deferred
);
create index views_database_idx on public.database_views(database_id);
create table public.record_relations (
  from_record_id uuid not null,
  property_id uuid not null,
  database_id uuid not null,
  workspace_id uuid not null,
  to_record_id uuid not null,
  primary key(from_record_id,property_id,to_record_id),
  foreign key(from_record_id,database_id,workspace_id) references public.database_records(id,database_id,workspace_id) on delete cascade deferrable initially deferred,
  foreign key(property_id,database_id,workspace_id) references public.database_properties(id,database_id,workspace_id) on delete cascade deferrable initially deferred,
  foreign key(to_record_id,workspace_id) references public.database_records(id,workspace_id) on delete cascade deferrable initially deferred
);
create index relations_target_idx on public.record_relations(to_record_id);
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  page_id uuid not null,
  storage_path text not null unique,
  name text not null,
  mime_type text,
  size bigint check(size between 0 and 20971520),
  constraint attachments_scoped_path check(storage_path like workspace_id::text || '/' || page_id::text || '/%'),
  created_at timestamptz not null default now(),
  foreign key(page_id,workspace_id) references public.pages(id,workspace_id) on delete cascade deferrable initially deferred
);

create function public.owns_workspace(target uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.workspaces where id=target and owner_id=(select auth.uid()));
$$;
revoke all on function public.owns_workspace(uuid) from public;
grant execute on function public.owns_workspace(uuid) to authenticated;
alter table public.profiles enable row level security;
create policy profile_owner on public.profiles for all to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
alter table public.workspaces enable row level security;
create policy workspace_owner on public.workspaces for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
do $$ declare table_name text; begin
  foreach table_name in array array['pages','documents','databases','database_properties','database_records','record_values','database_views','record_relations','attachments'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy private_owner on public.%I for all to authenticated using(public.owns_workspace(workspace_id)) with check(public.owns_workspace(workspace_id))',table_name);
  end loop;
end $$;
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.profiles,public.workspaces,public.pages,public.documents,public.databases,public.database_properties,public.database_records,public.record_values,public.database_views,public.record_relations,public.attachments to authenticated;
revoke all on public.profiles,public.workspaces,public.pages,public.documents,public.databases,public.database_properties,public.database_records,public.record_values,public.database_views,public.record_relations,public.attachments from anon;

create function public.check_page_cycle() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.parent_id is null then return new; end if;
  if exists(with recursive parents as (
    select id,parent_id,array[id] as visited from public.pages where id=new.parent_id
    union all select p.id,p.parent_id,parents.visited || p.id from public.pages p join parents on p.id=parents.parent_id where not p.id=any(parents.visited)
  ) select 1 from parents where id=new.id) then raise exception 'A page cannot be moved inside itself or one of its descendants.'; end if;
  return new;
end $$;
create constraint trigger pages_no_cycles after insert or update of parent_id on public.pages deferrable initially deferred for each row execute function public.check_page_cycle();

create function public.check_relation_target() returns trigger language plpgsql security definer set search_path=public as $$
declare prop public.database_properties; target_database uuid;
begin
  -- Deferred triggers may outlive rows removed by a cascading record deletion.
  if not exists(select 1 from public.record_relations where from_record_id=new.from_record_id and property_id=new.property_id and to_record_id=new.to_record_id) then return null; end if;
  select * into prop from public.database_properties where id=new.property_id;
  select database_id into target_database from public.database_records where id=new.to_record_id;
  if prop.type<>'relation' or nullif(prop.config->>'related_database_id','')::uuid is distinct from target_database then raise exception 'Relation target must belong to the configured database.'; end if;
  return new;
end $$;
create constraint trigger relation_target_guard after insert or update on public.record_relations deferrable initially deferred for each row execute function public.check_relation_target();

create function public.check_property_scope() returns trigger language plpgsql security definer set search_path=public as $$
declare target uuid; current_config jsonb; current_type text; scope_id uuid;
begin
  select config,type,workspace_id into current_config,current_type,scope_id from public.database_properties where id=new.id;
  if not found then return null; end if;
  if current_type='relation' and nullif(current_config->>'related_database_id','') is not null then
    target := (current_config->>'related_database_id')::uuid;
    if not exists(select 1 from public.databases where id=target and workspace_id=scope_id) then raise exception 'A relation must target a database in the same workspace.'; end if;
  end if;
  return new;
end $$;
create constraint trigger property_scope_guard after insert or update on public.database_properties deferrable initially deferred for each row execute function public.check_property_scope();

create function public.clear_deleted_database_links() returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.database_properties set config=config-'related_database_id' where workspace_id=old.workspace_id and config->>'related_database_id'=old.id::text;
  return old;
end $$;
create trigger databases_clear_links before delete on public.databases for each row execute function public.clear_deleted_database_links();

create function public.check_active_workspace() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.active_workspace_id is not null and not exists(select 1 from public.workspaces where id=new.active_workspace_id and owner_id=new.id) then raise exception 'The active workspace must belong to this account.'; end if;
  return new;
end $$;
create constraint trigger active_workspace_guard after insert or update of active_workspace_id on public.profiles deferrable initially deferred for each row execute function public.check_active_workspace();

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare workspace uuid := gen_random_uuid();
begin
  insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)));
  insert into public.workspaces(id,owner_id,name) values(workspace,new.id,'My workspace');
  update public.profiles set active_workspace_id=workspace where id=new.id;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- The database remains normalized; this RPC only assembles an atomic transport snapshot.
create function public.load_workspace_state() returns jsonb language plpgsql security invoker set search_path=public as $$
declare result jsonb; current_revision bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select sync_revision into current_revision from public.profiles where id=auth.uid();
  select jsonb_build_object(
    'active_workspace_id',(select active_workspace_id from public.profiles where id=auth.uid()),
    'workspaces',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'owner_id',owner_id) order by created_at) from public.workspaces),'[]'),
    'pages',coalesce((select jsonb_agg(to_jsonb(p) order by position) from public.pages p),'[]'),
    'documents',coalesce((select jsonb_agg(to_jsonb(d)-'workspace_id') from public.documents d),'[]'),
    'databases',coalesce((select jsonb_agg(to_jsonb(d)-'created_at'-'updated_at') from public.databases d),'[]'),
    'properties',coalesce((select jsonb_agg(to_jsonb(p)-'workspace_id' order by position) from public.database_properties p),'[]'),
    'views',coalesce((select jsonb_agg(to_jsonb(v)-'workspace_id') from public.database_views v),'[]'),
    'records',coalesce((select jsonb_agg((to_jsonb(r)-'workspace_id') || jsonb_build_object('values',
      coalesce((select jsonb_object_agg(v.property_id::text,v.value) from public.record_values v where v.record_id=r.id),'{}') ||
      coalesce((select jsonb_object_agg(a.property_id::text,a.ids) from (select rr.property_id,jsonb_agg(rr.to_record_id order by rr.to_record_id) as ids from public.record_relations rr where rr.from_record_id=r.id group by rr.property_id) a),'{}')
    ) order by r.position) from public.database_records r),'[]')
  ) into result;
  return jsonb_build_object('state',result,'revision',coalesce(current_revision,0));
end $$;

create function public.save_workspace_state(p_state jsonb,p_expected_revision bigint) returns bigint language plpgsql security invoker set search_path=public as $$
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
  insert into public.databases(id,workspace_id,page_id,name)
    select x.id,x.workspace_id,x.page_id,x.name from jsonb_to_recordset(p_state->'databases') as x(id uuid,workspace_id uuid,page_id uuid,name text)
    on conflict(id) do update set name=excluded.name,updated_at=now();
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
  insert into public.database_views(id,workspace_id,database_id,name,type,filters,sorts,hidden_properties,property_order,group_by)
    select x.id,d.workspace_id,x.database_id,x.name,x.type,coalesce(x.filters,'[]'),coalesce(x.sorts,'[]'),coalesce(x.hidden_properties,'[]'),coalesce(x.property_order,'[]'),x.group_by from jsonb_to_recordset(p_state->'views') as x(id uuid,database_id uuid,name text,type text,filters jsonb,sorts jsonb,hidden_properties jsonb,property_order jsonb,group_by uuid) join public.databases d on d.id=x.database_id
    on conflict(id) do update set name=excluded.name,type=excluded.type,filters=excluded.filters,sorts=excluded.sorts,hidden_properties=excluded.hidden_properties,property_order=excluded.property_order,group_by=excluded.group_by;
  delete from public.documents where page_id not in (select (value->>'page_id')::uuid from jsonb_array_elements(p_state->'documents'));
  delete from public.database_records where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'records'));
  delete from public.databases where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'databases'));
  delete from public.pages where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'pages'));
  delete from public.workspaces where id not in (select (value->>'id')::uuid from jsonb_array_elements(p_state->'workspaces'));
  if not public.owns_workspace((p_state->>'active_workspace_id')::uuid) then raise exception 'Invalid active workspace'; end if;
  update public.profiles set active_workspace_id=(p_state->>'active_workspace_id')::uuid,sync_revision=sync_revision+1,updated_at=now() where id=auth.uid() returning sync_revision into next_revision;
  return next_revision;
end $$;
revoke all on function public.load_workspace_state() from public;
revoke all on function public.save_workspace_state(jsonb,bigint) from public;
grant execute on function public.load_workspace_state() to authenticated;
grant execute on function public.save_workspace_state(jsonb,bigint) to authenticated;

create function public.search_workspace(query text) returns table(id uuid,title text,workspace_id uuid,excerpt text) language sql stable security invoker set search_path=public as $$
 select p.id,p.title,p.workspace_id,left(coalesce(d.markdown,p.description),200)
 from public.pages p left join public.documents d on d.page_id=p.id
 where p.deleted_at is null and (to_tsvector('simple',p.title || ' ' || coalesce(d.markdown,'')) @@ websearch_to_tsquery('simple',query) or p.title ilike '%' || query || '%')
 order by ts_rank(to_tsvector('simple',p.title || ' ' || coalesce(d.markdown,'')),websearch_to_tsquery('simple',query)) desc limit 50;
$$;
revoke all on function public.search_workspace(text) from public;
grant execute on function public.search_workspace(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('attachments','attachments',false,20971520,array['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain']) on conflict(id) do nothing;
create policy attachment_owner_select on storage.objects for select to authenticated using(bucket_id='attachments' and public.owns_workspace((storage.foldername(name))[1]::uuid));
create policy attachment_owner_insert on storage.objects for insert to authenticated with check(bucket_id='attachments' and public.owns_workspace((storage.foldername(name))[1]::uuid));
create policy attachment_owner_update on storage.objects for update to authenticated using(bucket_id='attachments' and public.owns_workspace((storage.foldername(name))[1]::uuid)) with check(bucket_id='attachments' and public.owns_workspace((storage.foldername(name))[1]::uuid));
create policy attachment_owner_delete on storage.objects for delete to authenticated using(bucket_id='attachments' and public.owns_workspace((storage.foldername(name))[1]::uuid));
