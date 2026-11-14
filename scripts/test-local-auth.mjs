/** Real HTTP authentication, persistence, and RLS checks. Refuses non-loopback URLs. */
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const workdir = process.env.SUPABASE_TEST_WORKDIR;
const args = ['status', ...(workdir ? ['--workdir',workdir] : []), '-o','json'];
const status = JSON.parse(execFileSync('supabase',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const origin = new URL(status.API_URL);
if (!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)) throw new Error('This test only runs against local Supabase.');
const apiKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
const adminKey = status.SERVICE_ROLE_KEY;
if (!apiKey || !adminKey) throw new Error('Local Supabase status did not provide the test keys.');
const users = [];
async function request(path,{token,method='GET',body,admin=false,allowError=false}={}) {
  const response = await fetch(`${origin.origin}${path}`,{method,headers:{apikey:admin?adminKey:apiKey,Authorization:`Bearer ${admin?adminKey:token||apiKey}`,'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text = await response.text();
  let data; try { data = text?JSON.parse(text):null; } catch { data=text; }
  if (!response.ok && !allowError) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return {status:response.status,data};
}
const rpc = (name,token,body={})=>request(`/rest/v1/rpc/${name}`,{token,method:'POST',body});
const password = `Slate-test-${randomUUID()}-Aa9!`;
async function register(label) {
  const email = `slate-e2e-${label}-${Date.now()}-${randomUUID().slice(0,8)}@example.test`;
  const {data} = await request('/auth/v1/signup',{method:'POST',body:{email,password,data:{display_name:`Test ${label}`}}});
  assert.ok(data.user?.id,'Registration returns a user');
  users.push(data.user.id);
  assert.ok(data.access_token,'Local development must have email confirmations disabled for this check');
  return {email,userId:data.user.id,token:data.access_token,refresh:data.refresh_token};
}
try {
  const a = await register('a'), b = await register('b');
  const login = await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:a.email,password}});
  assert.equal(login.data.user.id,a.userId);
  a.token=login.data.access_token;
  const refreshed = await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:login.data.refresh_token}});
  a.token=refreshed.data.access_token;
  assert.equal((await request('/auth/v1/user',{token:a.token})).data.id,a.userId);
  console.log('PASS registration, password login, session refresh, and verified identity');
  const initial = (await rpc('load_workspace_state',a.token)).data;
  assert.equal(initial.state.workspaces.length,1);
  assert.equal(initial.state.workspaces[0].owner_id,a.userId);
  const state = initial.state;
  const workspaceId=randomUUID();
  state.workspaces.push({id:workspaceId,name:'Auth smoke workspace'});state.active_workspace_id=workspaceId;
  const root=randomUUID(), child=randomUUID(), db1=randomUUID(), db2=randomUUID(), dbPage1=randomUUID(), dbPage2=randomUUID(), recPage1=randomUUID(), recPage2=randomUUID(), rec1=randomUUID(),rec2=randomUUID(),title1=randomUUID(),title2=randomUUID(),relation=randomUUID(),amount=randomUUID();
  const now=new Date().toISOString();
  const page=(id,title,parent_id=null,kind='document',database_id)=>({id,workspace_id:workspaceId,parent_id,title,icon:'',kind,database_id,description:'',position:0,favorite:false,deleted_at:null,created_at:now,updated_at:now});
  state.pages=[page(root,'Private notes'),page(child,'Nested notes',root),page(dbPage1,'Projects',root,'database',db1),page(dbPage2,'Resources',root,'database',db2),page(recPage1,'Project A',dbPage1),page(recPage2,'Server A',dbPage2)];
  state.documents=state.pages.map(p=>({page_id:p.id,markdown:p.id===child?'## Persistent content\n\nA private nested note.':'',updated_at:now}));
  state.databases=[{id:db1,workspace_id:workspaceId,page_id:dbPage1,name:'Projects'},{id:db2,workspace_id:workspaceId,page_id:dbPage2,name:'Resources'}];
  state.properties=[{id:title1,database_id:db1,name:'Name',type:'title',position:0,width:220,config:{}},{id:title2,database_id:db2,name:'Name',type:'title',position:0,width:220,config:{}},{id:amount,database_id:db1,name:'Budget',type:'currency',position:1,width:150,config:{}},{id:relation,database_id:db2,name:'Project',type:'relation',position:1,width:220,config:{related_database_id:db1}}];
  state.records=[{id:rec1,database_id:db1,page_id:recPage1,position:0,values:{[title1]:'Project A',[amount]:1300},created_at:now,updated_at:now},{id:rec2,database_id:db2,page_id:recPage2,position:0,values:{[title2]:'Server A',[relation]:[rec1]},created_at:now,updated_at:now}];
  state.views=[{id:randomUUID(),database_id:db1,name:'Table',type:'table',filters:[],sorts:[],hidden_properties:[],property_order:[amount,title1]},{id:randomUUID(),database_id:db2,name:'Board',type:'board',filters:[],sorts:[],hidden_properties:[]}];
  const save=await rpc('save_workspace_state',a.token,{p_state:state,p_expected_revision:initial.revision});
  assert.equal(save.data,initial.revision+1);
  const loaded=(await rpc('load_workspace_state',a.token)).data;
  assert.equal(loaded.state.workspaces.length,2);
  assert.equal(loaded.state.pages.find(p=>p.id===child).parent_id,root);
  assert.match(loaded.state.documents.find(d=>d.page_id===child).markdown,/Persistent content/);
  assert.deepEqual(loaded.state.records.find(r=>r.id===rec2).values[relation],[rec1]);
  assert.deepEqual(loaded.state.views.find(v=>v.database_id===db1).property_order,[amount,title1]);
  assert.equal((await request('/rest/v1/record_values?select=record_id,property_id',{token:a.token})).data.length,3);
  assert.equal((await request('/rest/v1/record_relations?select=from_record_id,to_record_id',{token:a.token})).data.length,1);
  console.log('PASS default workspace, additional workspace, nested pages, documents, views, normalized values, and real relations');

  const attachmentId=randomUUID(), objectPath=`${workspaceId}/${child}/${attachmentId}.png`;
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmj8AAAAASUVORK5CYII=','base64');
  const upload=await fetch(`${origin.origin}/storage/v1/object/attachments/${objectPath}`,{method:'POST',headers:{apikey:apiKey,Authorization:`Bearer ${a.token}`,'Content-Type':'image/png'},body:image});
  assert.equal(upload.status,200,`Owner upload failed: ${await upload.text()}`);
  try {
    await request('/rest/v1/attachments',{token:a.token,method:'POST',body:{id:attachmentId,workspace_id:workspaceId,page_id:child,storage_path:objectPath,name:'test.png',mime_type:'image/png',size:image.length}});
    assert.equal((await request(`/rest/v1/attachments?id=eq.${attachmentId}&select=id`,{token:b.token})).data.length,0);
    const forbidden=await fetch(`${origin.origin}/storage/v1/object/authenticated/attachments/${objectPath}`,{headers:{apikey:apiKey,Authorization:`Bearer ${b.token}`}});
    assert.ok(!forbidden.ok,'Another account must not read the private object');
    const forbiddenSign=await request(`/storage/v1/object/sign/attachments/${objectPath}`,{token:b.token,method:'POST',body:{expiresIn:60},allowError:true});
    assert.ok(forbiddenSign.status>=400);assert.ok(!forbiddenSign.data?.signedURL);
    const ownSign=await request(`/storage/v1/object/sign/attachments/${objectPath}`,{token:a.token,method:'POST',body:{expiresIn:60}});
    assert.ok(ownSign.data.signedURL);
    const signedPath=ownSign.data.signedURL.startsWith('/storage/v1/')?ownSign.data.signedURL:`/storage/v1${ownSign.data.signedURL}`;
    assert.equal((await fetch(`${origin.origin}${signedPath}`)).status,200);
    const invalidId=randomUUID();
    const invalidMetadata=await request('/rest/v1/attachments',{token:a.token,method:'POST',body:{id:invalidId,workspace_id:workspaceId,page_id:child,storage_path:`${initial.state.workspaces[0].id}/${child}/${invalidId}.png`,name:'invalid.png',mime_type:'image/png',size:image.length},allowError:true});
    assert.equal(invalidMetadata.status,400);assert.equal(invalidMetadata.data.code,'23514');
    console.log('PASS private image upload, metadata isolation, signed owner access, foreign read/sign denial, and scoped path constraint');
  } finally {
    await request('/storage/v1/object/attachments',{token:a.token,method:'DELETE',body:{prefixes:[objectPath]}});
    await request(`/rest/v1/attachments?id=eq.${attachmentId}`,{token:a.token,method:'DELETE'});
  }

  assert.equal((await request(`/rest/v1/workspaces?id=eq.${workspaceId}&select=id`,{token:b.token})).data.length,0);
  assert.equal((await request(`/rest/v1/pages?id=eq.${child}&select=id`,{token:b.token})).data.length,0);
  const foreignWrite=await request('/rest/v1/pages',{token:b.token,method:'POST',body:{workspace_id:workspaceId,title:'Unauthorized'},allowError:true});
  assert.equal(foreignWrite.status,403);
  const other=(await rpc('load_workspace_state',b.token)).data;
  assert.equal(other.state.workspaces.length,1);
  assert.deepEqual(other.state.pages.map(p=>p.title),['Getting started'],'A new account starts with only its own Getting started page');
  const stale=await request('/rest/v1/rpc/save_workspace_state',{token:a.token,method:'POST',body:{p_state:state,p_expected_revision:initial.revision},allowError:true});
  assert.equal(stale.status,400);assert.match(stale.data.message,/conflict/);
  console.log('PASS cross-account read/write isolation and stale-save protection');
  const nextPassword=`Changed-${randomUUID()}-Aa9!`;
  await request('/auth/v1/user',{token:a.token,method:'PUT',body:{password:nextPassword}});
  const relogin=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:a.email,password:nextPassword}});
  const restored=(await rpc('load_workspace_state',relogin.data.access_token)).data;
  assert.equal(restored.state.documents.find(d=>d.page_id===child).markdown,loaded.state.documents.find(d=>d.page_id===child).markdown);
  await request('/auth/v1/logout',{token:relogin.data.access_token,method:'POST'});
  console.log('PASS password update, reauthentication persistence, and logout');
} finally {
  for (const id of users) await request(`/auth/v1/admin/users/${id}`,{admin:true,method:'DELETE'});
  console.log(`Cleaned up ${users.length} isolated local test accounts`);
}
