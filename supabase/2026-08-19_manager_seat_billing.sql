-- Run this after 2026-08-19_role_entitlements.sql on databases where that
-- migration was already applied before seat-based manager billing shipped.
alter table public.manager_plans drop constraint if exists manager_plans_polar_product_id_key;

create table if not exists public.manager_checkout_intents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roles text[] not null,
  status text not null default 'pending' check (status in ('pending','complete','failed')),
  polar_subscription_id text,
  updated_at timestamptz not null default now(),
  check (cardinality(roles) between 1 and 5),
  check (roles <@ array['marketing','customer-success','seo','product','operations']::text[])
);
alter table public.manager_checkout_intents enable row level security;
drop policy if exists "owners read own manager checkout intent" on public.manager_checkout_intents;
create policy "owners read own manager checkout intent" on public.manager_checkout_intents
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.manager_checkout_intents from anon, authenticated;
