-- Delivery feedback and suppression state for Resend webhooks.
alter table public.recovery_deliveries
  add column if not exists delivery_status text,
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists unsubscribed_at timestamptz;

create table if not exists public.resend_webhook_events (
  svix_id text primary key,
  event_type text not null,
  resend_email_id text,
  received_at timestamptz not null default now()
);
alter table public.resend_webhook_events enable row level security;
revoke all on public.resend_webhook_events from anon, authenticated;
