-- Product Manager research, weekly catalog snapshots, and lifecycle actions.
create table if not exists public.product_research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_domain text not null,
  target_market text not null check (target_market in ('US','Canada','GCC')),
  status text not null default 'completed' check (status in ('running','completed','failed')),
  catalog_snapshot jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  selected_candidate integer,
  action_id uuid references public.shopify_actions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_research_runs_owner_time on public.product_research_runs(user_id,created_at desc);
alter table public.product_research_runs enable row level security;
create policy "owners read product research" on public.product_research_runs for select to authenticated using(auth.uid()=user_id);

create table if not exists public.product_manager_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_domain text not null,
  week_start date not null,
  catalog_hash text not null,
  summary jsonb not null,
  opportunities jsonb not null,
  created_at timestamptz not null default now(),
  unique(user_id,shop_domain,week_start)
);
alter table public.product_manager_snapshots enable row level security;
create policy "owners read product manager snapshots" on public.product_manager_snapshots for select to authenticated using(auth.uid()=user_id);

alter table public.shopify_actions drop constraint if exists shopify_actions_kind_check;
alter table public.shopify_actions add constraint shopify_actions_kind_check check (kind in (
  'product_update','product_status_update','product_draft_create','collection_upsert',
  'discount_code_create','discount_automatic_create'
));
