-- Auditable observe -> prioritize -> propose runs for the autonomous Product Manager.
create table if not exists public.product_manager_decision_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shop_domain text not null,
  trigger text not null default 'scheduled_observer',
  candidates jsonb not null default '[]'::jsonb,
  selected_product_id text,
  action_id uuid references public.shopify_actions(id) on delete set null,
  outcome text not null check (outcome in ('proposed','waiting_for_approval','no_safe_action','skipped_entitlement','failed')),
  error text,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists product_manager_decision_runs_owner_time
  on public.product_manager_decision_runs(user_id,completed_at desc);

alter table public.product_manager_decision_runs enable row level security;
create policy "owners read product manager decisions"
  on public.product_manager_decision_runs for select to authenticated
  using(auth.uid()=user_id);
