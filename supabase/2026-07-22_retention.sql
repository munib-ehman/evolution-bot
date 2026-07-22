-- Retention Center — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- One row per owner: their edited retention email templates (2 win-back
-- touches + 1 review request, plus the optional review-page link), as
-- { winback: [...], review: [...], reviewLink: "..." }. No secrets and no
-- customer data live here — customer detail is fetched live from Shopify and
-- never stored. The browser reads/writes this row directly (owner-scoped RLS).

create table public.retention_sequences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  templates  jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.retention_sequences enable row level security;

create policy "owners read own retention templates"
  on public.retention_sequences
  for select to authenticated
  using (auth.uid() = user_id);

create policy "owners create own retention templates"
  on public.retention_sequences
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "owners update own retention templates"
  on public.retention_sequences
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
