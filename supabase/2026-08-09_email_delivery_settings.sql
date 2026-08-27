-- Merchant-owned email identity configuration. Secrets are encrypted server-side;
-- authenticated merchants may read only the non-secret configuration fields.
create table if not exists public.email_delivery_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null check (mode in ('merchant_domain', 'merchant_resend', 'evolution_shared')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'test_required', 'ready', 'error')),
  sending_domain text,
  sender_name text not null,
  sender_email text not null,
  reply_to text not null,
  provider text not null default 'resend',
  provider_domain_id text,
  provider_secret_ciphertext text,
  dns_records jsonb not null default '[]'::jsonb,
  fallback_warning_acknowledged boolean not null default false,
  test_sent_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_delivery_settings enable row level security;
create policy "owners read own email delivery settings"
  on public.email_delivery_settings for select to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.email_delivery_settings from authenticated;
