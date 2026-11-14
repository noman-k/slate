-- A new account starts on a short "Getting started" page instead of an empty workspace.
-- Registration asks only for an email and a password; the display name still falls back
-- to the email's local part. The page is an ordinary page the person can edit or delete.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare
  workspace uuid := gen_random_uuid();
  welcome uuid := gen_random_uuid();
begin
  insert into public.profiles(id,display_name) values(new.id,coalesce(nullif(new.raw_user_meta_data->>'display_name',''),split_part(new.email,'@',1)));
  insert into public.workspaces(id,owner_id,name) values(workspace,new.id,'My workspace');
  update public.profiles set active_workspace_id=workspace where id=new.id;
  insert into public.pages(id,workspace_id,title,icon,kind,position) values(welcome,workspace,'Getting started','icon:sparkles:blue','document',0);
  insert into public.documents(page_id,workspace_id,markdown) values(welcome,workspace,$md$Welcome to Slate: a private place for your notes, your databases and the checklists you run.

## Try these first

- [ ] Click **New page** in the sidebar and write something of your own
- [ ] On an empty line, type `/` to add a heading, a to-do list, a table or a database
- [ ] Press **⌘ K** (Ctrl K on Windows) to search everything
- [ ] Turn a routine into a playbook: start a new page, choose **Playbook** and pick a template
- [ ] Choose light or dark in **Settings**

## Good to know

- Everything here is private to your account.
- Every page has a Markdown view. Pages export as Markdown, and databases as CSV.
- Want an AI agent such as Claude to read your workspace? Create a key in **Settings › AI agents**.

Done exploring? Delete this page, or keep it as a cheat sheet.
$md$);
  return new;
end $$;
