-- Webhook idempotency — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Shopify redelivers webhooks (retries for 48h on non-2xx, plus occasional
-- at-least-once duplicates). Every delivery carries a unique
-- X-Shopify-Webhook-Id; /api/shopify-webhook and /api/shopify-compliance
-- claim it here with an insert-or-ignore before processing — a duplicate id
-- means the work already happened, so the handler answers 200 and stops.
-- Service-role only; the browser never touches this table.
--
-- Rows are only useful inside Shopify's 48h retry window. Optional purge via
-- pg_cron: delete from webhook_events where received_at < now() - interval '7 days';

create table public.webhook_events (
  webhook_id  text primary key,
  topic       text,
  shop        text,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
