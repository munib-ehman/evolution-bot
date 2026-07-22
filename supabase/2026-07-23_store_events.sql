-- Live store events — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- The push channel behind the Operations Center's live updates: Shopify
-- webhooks land on /api/shopify-webhook, which inserts a row here via the
-- service role; Supabase Realtime (WebSockets) streams the insert to the
-- owner's browser instantly. Owners can only READ their own events — there
-- is deliberately no insert/update policy for authenticated users.

create table public.store_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       text not null,   -- order.new | stock.out | stock.low | …
  title      text not null,   -- human line, e.g. "New order #1002 — $49"
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index store_events_user_created
  on public.store_events (user_id, created_at desc);

alter table public.store_events enable row level security;

create policy "owners read own events"
  on public.store_events
  for select to authenticated
  using (auth.uid() = user_id);

-- Stream inserts over Realtime (RLS still applies per subscriber).
alter publication supabase_realtime add table public.store_events;
