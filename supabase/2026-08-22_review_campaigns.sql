create table if not exists public.review_campaigns (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed','scheduled','rejected','completed','failed')),
  touch jsonb not null, review_link text not null, buyer_count integer not null default 0,
  approved_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.review_deliveries (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.review_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, order_id text not null, due_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','skipped','failed','cancelled')),
  attempt_count integer not null default 0, resend_email_id text, delivery_status text, error text, sent_at timestamptz,
  delivered_at timestamptz, opened_at timestamptz, clicked_at timestamptz, bounced_at timestamptz, complained_at timestamptz, unsubscribed_at timestamptz,
  updated_at timestamptz not null default now(), unique(campaign_id,order_id)
);
create index if not exists review_campaigns_owner_time on public.review_campaigns(user_id,created_at desc);
create index if not exists review_deliveries_due on public.review_deliveries(status,due_at);
alter table public.review_campaigns enable row level security; alter table public.review_deliveries enable row level security;
create policy "owners read own review campaigns" on public.review_campaigns for select to authenticated using (auth.uid()=user_id);
create policy "owners read own review deliveries" on public.review_deliveries for select to authenticated using (auth.uid()=user_id);
revoke insert,update,delete on public.review_campaigns from authenticated;
revoke insert,update,delete on public.review_deliveries from authenticated;
alter table public.review_deliveries add column if not exists unsubscribed_at timestamptz;
