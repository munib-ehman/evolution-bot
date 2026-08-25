-- Durable abandoned-cart campaign scheduling. Customer PII is never stored;
-- deliveries reference Shopify checkout IDs and resolve live at send time.
create table if not exists public.recovery_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed','scheduled','paused','rejected','completed','failed')),
  touches jsonb not null,
  cart_count integer not null default 0,
  total_value numeric not null default 0,
  currency text,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recovery_campaigns_owner_time on public.recovery_campaigns(user_id, created_at desc);

create table if not exists public.recovery_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.recovery_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  checkout_id text not null,
  touch_index integer not null check (touch_index between 0 and 2),
  due_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','skipped','failed','cancelled')),
  attempt_count integer not null default 0,
  resend_email_id text,
  error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(campaign_id, checkout_id, touch_index)
);
create index if not exists recovery_deliveries_due on public.recovery_deliveries(status, due_at);
create index if not exists recovery_deliveries_campaign on public.recovery_deliveries(campaign_id, status);

alter table public.recovery_campaigns enable row level security;
alter table public.recovery_deliveries enable row level security;
create policy "owners read own recovery campaigns" on public.recovery_campaigns for select to authenticated using (auth.uid() = user_id);
create policy "owners read own recovery deliveries" on public.recovery_deliveries for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.recovery_campaigns from authenticated;
revoke insert, update, delete on public.recovery_deliveries from authenticated;
