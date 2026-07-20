-- Expiring Shopify tokens — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Shopify no longer accepts non-expiring Admin API tokens (403 "Non-expiring
-- access tokens are no longer accepted"). The OAuth exchange now requests
-- expiring offline tokens (expiring=1): access tokens last ~24h and are
-- auto-refreshed server-side with the 90-day rotating refresh token stored
-- here. Like access_token, the new columns are service-role-only: they are
-- NOT in the column-level grant from 2026-07-19_shopify.sql, so browsers
-- can never select them.
--
-- After running this, every owner must RECONNECT their store once (the old
-- stored tokens are the rejected non-expiring kind).

alter table public.shopify_connections
  add column if not exists refresh_token            text,
  add column if not exists token_expires_at         timestamptz,
  add column if not exists refresh_token_expires_at timestamptz;
