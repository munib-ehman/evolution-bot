-- Polar billing — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Polar (polar.sh, merchant of record) bills the WEB rail: standalone
-- runevolution.io accounts with no connected Shopify store. Shopify-connected
-- accounts stay on Shopify App Pricing (App Store policy). plan_source keeps
-- the rails from stepping on each other: the Polar webhook only downgrades
-- plan_source='polar' rows, the Shopify webhook only 'shopify' rows.
-- 'paddle' stays in the constraint for history — the Paddle rail never went
-- live and its client stub is removed in this change.

alter table public.profiles
  drop constraint if exists profiles_plan_source_check;

alter table public.profiles
  add constraint profiles_plan_source_check
    check (plan_source in ('manual', 'paddle', 'shopify', 'polar'));
