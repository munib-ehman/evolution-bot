create table if not exists public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed','scheduled','rejected','completed','failed')),
  name text not null, segment text not null check (segment in ('subscribers','recent','repeat','vip','lapsed')),
  subject text not null, body text not null, scheduled_at timestamptz not null, customer_count integer not null default 0,
  approved_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.broadcast_deliveries (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.broadcast_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, customer_id text not null, due_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','skipped','failed','cancelled')),
  attempt_count integer not null default 0, resend_email_id text, delivery_status text, error text, sent_at timestamptz,
  delivered_at timestamptz, opened_at timestamptz, clicked_at timestamptz, bounced_at timestamptz, complained_at timestamptz,
  unsubscribed_at timestamptz, updated_at timestamptz not null default now(), unique(campaign_id, customer_id)
);
create index if not exists broadcast_campaigns_owner_time on public.broadcast_campaigns(user_id, created_at desc);
create index if not exists broadcast_deliveries_due on public.broadcast_deliveries(status, due_at);
alter table public.broadcast_campaigns enable row level security; alter table public.broadcast_deliveries enable row level security;
create policy "owners read own broadcast campaigns" on public.broadcast_campaigns for select to authenticated using (auth.uid() = user_id);
create policy "owners read own broadcast deliveries" on public.broadcast_deliveries for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.broadcast_campaigns from authenticated;
revoke insert, update, delete on public.broadcast_deliveries from authenticated;
create table if not exists public.marketing_suppressions (
  user_id uuid not null references auth.users(id) on delete cascade, customer_id text not null,
  reason text not null default 'unsubscribed', created_at timestamptz not null default now(), primary key(user_id,customer_id)
);
alter table public.marketing_suppressions enable row level security;
create policy "owners read own marketing suppressions" on public.marketing_suppressions for select to authenticated using (auth.uid()=user_id);
revoke insert,update,delete on public.marketing_suppressions from authenticated;
