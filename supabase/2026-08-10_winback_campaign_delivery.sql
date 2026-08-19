-- Durable win-back campaigns. Customer contact data stays in Shopify; only
-- Shopify customer IDs are persisted and resolved again immediately before send.
create table if not exists public.winback_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed','scheduled','paused','rejected','completed','failed')),
  touches jsonb not null,
  segment text not null default 'all' check (segment in ('best','vip','repeat','recent','all')),
  customer_count integer not null default 0,
  lifetime_value numeric not null default 0,
  currency text,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.winback_campaigns add column if not exists segment text not null default 'all';

create table if not exists public.winback_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.winback_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id text not null,
  touch_index integer not null check (touch_index between 0 and 1),
  due_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','skipped','failed','cancelled')),
  attempt_count integer not null default 0,
  resend_email_id text,
  delivery_status text,
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  unsubscribed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(campaign_id, customer_id, touch_index)
);

create index if not exists winback_campaigns_owner_time on public.winback_campaigns(user_id, created_at desc);
create index if not exists winback_deliveries_due on public.winback_deliveries(status, due_at);
create index if not exists winback_deliveries_campaign on public.winback_deliveries(campaign_id, status);
alter table public.winback_campaigns enable row level security;
alter table public.winback_deliveries enable row level security;
create policy "owners read own winback campaigns" on public.winback_campaigns for select to authenticated using (auth.uid() = user_id);
create policy "owners read own winback deliveries" on public.winback_deliveries for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.winback_campaigns from authenticated;
revoke insert, update, delete on public.winback_deliveries from authenticated;
