-- A single founder-facing Autopilot preference: how much finished work the
-- active managers should prepare for the shared approval inbox each day.
create table if not exists public.autonomy_contracts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  max_actions_per_day int not null default 5 check (max_actions_per_day between 1 and 25),
  daily_digest boolean not null default true,
  setup_complete boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.autonomy_contracts enable row level security;
create policy "owners manage autonomy contract" on public.autonomy_contracts for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
