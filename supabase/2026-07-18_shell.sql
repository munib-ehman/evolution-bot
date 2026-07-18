-- MVP shell tables — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Four tables: profiles (plan flag, flipped manually in the Table Editor),
-- stores (the pasted store URL), audits (written ONLY by /api/audit via the
-- service role — no client insert policy on purpose, so anonymous funnel
-- runs are captured as leads), and tasks (the ops queue: owners file
-- requests, the team fulfills them).
--
-- Admin access is granted by RLS policies keyed on the login email below.
-- To add an operator, edit the admin policies and re-run just those.

-- ── profiles ── one row per user; plan is flipped manually (Table Editor
-- bypasses RLS). No user update policy → users can't self-upgrade.
create table public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  plan       text not null default 'free' check (plan in ('free', 'operator')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "users insert own free profile"
  on public.profiles
  for insert to authenticated
  with check (auth.uid() = user_id and plan = 'free');

create policy "users read own profile"
  on public.profiles
  for select to authenticated
  using (auth.uid() = user_id);

-- ── stores ── the connected store (paste-URL onboarding; one per user).
create table public.stores (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  url        text not null,
  platform   text,                  -- 'shopify' | 'unknown'
  created_at timestamptz not null default now()
);

alter table public.stores enable row level security;

create policy "users manage own store"
  on public.stores
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── audits ── inserted only by the /api/audit edge function via the service
-- role (bypasses RLS). user_id is null for anonymous funnel runs.
create table public.audits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users (id) on delete set null,
  store_url  text not null,
  score      int,
  report     jsonb not null,        -- the full AuditReport JSON
  created_at timestamptz not null default now()
);

create index audits_user_time on public.audits (user_id, created_at desc);

alter table public.audits enable row level security;

create policy "users read own audits"
  on public.audits
  for select to authenticated
  using (auth.uid() = user_id);

-- ── tasks ── the ops queue. Owners insert requests; the team updates
-- status/result (admin policies below); results surface back in the app.
create table public.tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  store_id   uuid references public.stores (id) on delete set null,
  tool       text not null,         -- one of the 6 verticals, or 'custom'
  request    text not null,
  status     text not null default 'new' check (status in ('new', 'in_progress', 'done')),
  result     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_user_time on public.tasks (user_id, created_at desc);
create index tasks_status on public.tasks (status, created_at);

alter table public.tasks enable row level security;

create policy "users insert own new tasks"
  on public.tasks
  for insert to authenticated
  with check (auth.uid() = user_id and status = 'new' and result is null);

create policy "users read own tasks"
  on public.tasks
  for select to authenticated
  using (auth.uid() = user_id);

-- ── admin policies ── the ops team. Policies OR together, so these extend
-- the per-user rules above. The JWT email claim is the gate.
create policy "admins read all tasks"
  on public.tasks
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'muneeburr451@gmail.com');

create policy "admins update tasks"
  on public.tasks
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'muneeburr451@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'muneeburr451@gmail.com');

create policy "admins read all stores"
  on public.stores
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'muneeburr451@gmail.com');

create policy "admins read all audits"
  on public.audits
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'muneeburr451@gmail.com');

create policy "admins read all profiles"
  on public.profiles
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'muneeburr451@gmail.com');
