-- Shopify OAuth connections — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- One row per owner: their *.myshopify.com domain and the read-only Admin
-- API access token from the OAuth flow (/api/shopify-auth → Shopify →
-- /api/shopify-callback). The token is written and read ONLY by the edge
-- functions via the service role. Browsers can see THAT they're connected
-- (shop_domain, connected_at) but never the token — enforced by the
-- column-level grant below, on top of RLS.

create table public.shopify_connections (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  shop_domain  text not null unique,
  access_token text not null,
  scopes       text,
  connected_at timestamptz not null default now()
);

alter table public.shopify_connections enable row level security;

-- Column-level gate: authenticated browsers may only ever select the
-- non-secret columns, no matter what a policy allows.
revoke all on public.shopify_connections from anon, authenticated;
grant select (user_id, shop_domain, scopes, connected_at)
  on public.shopify_connections to authenticated;

create policy "users see own connection status"
  on public.shopify_connections
  for select to authenticated
  using (auth.uid() = user_id);

create policy "admins see all connection status"
  on public.shopify_connections
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'muneeburr451@gmail.com');
