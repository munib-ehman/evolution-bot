-- Shopify App Store compliance — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Two changes:
--
-- 1. shopify_connections becomes tombstone-able. When a merchant uninstalls
--    the app, the app/uninstalled webhook NULLs the tokens and stamps
--    uninstalled_at — but KEEPS the row, because Shopify sends shop/redact
--    up to 48h after uninstall and we still need the shop_domain → user_id
--    mapping to know whose data to erase. shop/redact then hard-deletes.
--
-- 2. profiles.plan_source records who controls the plan flag, so a Shopify
--    subscription webhook can never downgrade an account the team upgraded
--    manually (or a future Paddle subscriber).

alter table public.shopify_connections
  alter column access_token drop not null;

alter table public.shopify_connections
  add column if not exists uninstalled_at timestamptz;

alter table public.profiles
  add column if not exists plan_source text not null default 'manual'
    check (plan_source in ('manual', 'paddle', 'shopify'));
