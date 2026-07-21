-- Cart Recovery Center — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- One row per owner: their edited 3-touch recovery email sequence (subjects
-- + plain-text bodies with {{placeholders}}). No secrets and no customer
-- data live here — customer detail is fetched live from Shopify and never
-- stored. The browser reads/writes this row directly (owner-scoped RLS).

create table public.recovery_sequences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  touches    jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.recovery_sequences enable row level security;

create policy "owners read own sequence"
  on public.recovery_sequences
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owners create own sequence"
  on public.recovery_sequences
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "owners update own sequence"
  on public.recovery_sequences
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
