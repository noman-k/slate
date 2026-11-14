-- Messages sent through the contact form (/contact). Visitors and members can send one;
-- nobody can read them through the API: the operator reads them in the Supabase dashboard.
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  topic text not null check (topic in ('account', 'delete', 'privacy', 'other')),
  email text not null check (length(email) between 3 and 320 and email like '%_@_%'),
  message text not null check (length(message) between 1 and 5000),
  -- Set when the sender was signed in, so account and deletion requests can be trusted.
  user_id uuid references auth.users(id) on delete set null,
  handled_at timestamptz
);
create index contact_messages_created on public.contact_messages(created_at desc);
alter table public.contact_messages enable row level security;
-- No policies and no grants: the API can't read or write the table directly.
revoke all on table public.contact_messages from anon, authenticated;
-- The operator's tools (dashboard, service key) can read messages and mark them handled.
grant select, update, delete on table public.contact_messages to service_role;

-- The only way in. It records who sent it (if anyone was signed in) on the server side, so
-- a sender can't claim to be another account.
create function public.submit_contact_message(p_topic text, p_email text, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.contact_messages(topic, email, message, user_id)
  values (p_topic, lower(trim(p_email)), trim(p_message), auth.uid())
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.submit_contact_message(text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text) to anon, authenticated;
