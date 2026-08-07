-- Product hunt reports (free-tier feature). Inserts happen server-side via
-- the service role only; owners can read their own history.
create table if not exists public.product_hunts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  store_url text not null,
  niche text,
  report jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.product_hunts enable row level security;

drop policy if exists "own hunts" on public.product_hunts;
create policy "own hunts" on public.product_hunts
  for select using (auth.uid() = user_id);

create index if not exists product_hunts_user_created
  on public.product_hunts (user_id, created_at desc);
