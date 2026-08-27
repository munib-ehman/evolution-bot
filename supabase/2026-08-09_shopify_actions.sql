-- Evolution v1.1 approved Shopify actions.
-- Server functions own all mutations. Merchants can only read their records.

create table if not exists public.shopify_actions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  shop_domain      text not null,
  kind             text not null check (kind in (
    'product_update', 'product_draft_create', 'collection_upsert',
    'discount_code_create', 'discount_automatic_create'
  )),
  status           text not null default 'proposed' check (status in (
    'proposed', 'executing', 'succeeded', 'partial', 'failed',
    'stale', 'undone', 'expired'
  )),
  summary          text not null,
  payload          jsonb not null,
  before_state     jsonb not null default '{}'::jsonb,
  after_state      jsonb,
  result           jsonb,
  idempotency_key  uuid not null default gen_random_uuid() unique,
  error            text,
  expires_at       timestamptz not null default (now() + interval '24 hours'),
  approved_at      timestamptz,
  executed_at      timestamptz,
  undone_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists shopify_actions_user_time
  on public.shopify_actions (user_id, created_at desc);
create index if not exists shopify_actions_measurement
  on public.shopify_actions (status, executed_at)
  where status in ('succeeded', 'partial');

alter table public.shopify_actions enable row level security;
create policy "owners read own shopify actions"
  on public.shopify_actions for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.shopify_action_events (
  id          bigint generated always as identity primary key,
  action_id   uuid not null references public.shopify_actions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  event       text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists shopify_action_events_action
  on public.shopify_action_events (action_id, created_at);
alter table public.shopify_action_events enable row level security;
create policy "owners read own shopify action events"
  on public.shopify_action_events for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.shopify_action_metrics (
  id             bigint generated always as identity primary key,
  action_id      uuid not null references public.shopify_actions (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  window_days    int not null check (window_days in (0, 7, 14, 30)),
  metrics        jsonb not null,
  measured_at    timestamptz not null default now(),
  unique (action_id, window_days)
);

alter table public.shopify_action_metrics enable row level security;
create policy "owners read own shopify action metrics"
  on public.shopify_action_metrics for select to authenticated
  using (auth.uid() = user_id);

