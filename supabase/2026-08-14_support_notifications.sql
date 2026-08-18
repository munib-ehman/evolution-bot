create table if not exists public.support_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null,
  order_name text not null,
  status text not null default 'proposed' check (status in ('proposed','sent','resolved','failed')),
  resolution text not null check (resolution in ('investigating','ship_date','cancel_refund','custom')),
  subject text not null,
  body text not null,
  resend_email_id text,
  delivery_status text,
  approved_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  resolved_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, order_id)
);
create index if not exists support_notifications_owner_time on public.support_notifications(user_id, created_at desc);
create index if not exists support_notifications_resend on public.support_notifications(resend_email_id) where resend_email_id is not null;
alter table public.support_notifications enable row level security;
create policy "owners read own support notifications" on public.support_notifications for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.support_notifications from authenticated;
