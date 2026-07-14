-- Chat logging table — run this once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Every conversation turn from signed-in users is mirrored here so the
-- founder can review what users asked for (Dashboard → Table Editor →
-- chat_messages). RLS lets users write/read only their own rows; the
-- dashboard bypasses RLS, so you always see everything.

create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  user_email text,                 -- denormalized so the table is readable at a glance
  session_id text,                 -- groups one visit's messages into a conversation
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

-- Fast "show me this user's history, newest first" queries.
create index chat_messages_user_time on public.chat_messages (user_id, created_at desc);

alter table public.chat_messages enable row level security;

-- Signed-in users may log their own messages…
create policy "users insert own messages"
  on public.chat_messages
  for insert to authenticated
  with check (auth.uid() = user_id);

-- …and read back only their own (future-proofs cross-device chat history).
create policy "users read own messages"
  on public.chat_messages
  for select to authenticated
  using (auth.uid() = user_id);
