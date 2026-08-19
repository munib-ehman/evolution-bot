-- Independently purchasable manager roles. One active row grants exactly one role.
create table if not exists public.manager_plans (
  role text primary key check (role in ('marketing','customer-success','seo','product','operations')),
  name text not null,
  description text not null default '',
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd',
  billing_interval text not null default 'month' check (billing_interval in ('month','year')),
  polar_product_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.manager_plans enable row level security;
create policy "public reads active manager plans" on public.manager_plans for select using (active = true);
revoke insert, update, delete on public.manager_plans from anon, authenticated;

create table if not exists public.manager_checkout_intents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roles text[] not null,
  status text not null default 'pending' check (status in ('pending','complete','failed')),
  polar_subscription_id text,
  updated_at timestamptz not null default now(),
  check (cardinality(roles) between 1 and 5)
);
alter table public.manager_checkout_intents enable row level security;
create policy "owners read own manager checkout intent" on public.manager_checkout_intents
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.manager_checkout_intents from anon, authenticated;

create table if not exists public.role_entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('marketing','customer-success','seo','product','operations')),
  status text not null default 'active' check (status in ('active','inactive','past_due')),
  billing_provider text not null default 'manual' check (billing_provider in ('manual','polar','shopify')),
  provider_product_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.role_entitlements enable row level security;
create policy "owners read own role entitlements" on public.role_entitlements
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.role_entitlements from authenticated;

-- Preserve the access of customers who bought the former all-inclusive plan.
insert into public.role_entitlements (user_id, role, status, billing_provider)
select p.user_id, r.role, 'active', coalesce(nullif(p.plan_source, 'paddle'), 'manual')
from public.profiles p
cross join (values ('marketing'),('customer-success'),('seo'),('product'),('operations')) as r(role)
where p.plan = 'operator'
on conflict (user_id, role) do nothing;

-- Email identity is role-scoped: Operations never depends on Customer Success.
alter table public.email_delivery_settings add column if not exists role text;
update public.email_delivery_settings set role = 'marketing' where role is null;
alter table public.email_delivery_settings alter column role set not null;
alter table public.email_delivery_settings drop constraint if exists email_delivery_settings_role_check;
alter table public.email_delivery_settings add constraint email_delivery_settings_role_check
  check (role in ('marketing','customer-success','operations'));
alter table public.email_delivery_settings drop constraint if exists email_delivery_settings_pkey;
alter table public.email_delivery_settings add primary key (user_id, role);

alter table public.shopify_actions add column if not exists role text;
update public.shopify_actions set role = case
  when kind in ('discount_code_create','discount_automatic_create') then 'marketing'
  when kind = 'order_email_update' then 'operations'
  else 'product' end where role is null;
alter table public.shopify_actions alter column role set not null;
alter table public.shopify_actions drop constraint if exists shopify_actions_role_check;
alter table public.shopify_actions add constraint shopify_actions_role_check
  check (role in ('marketing','customer-success','seo','product','operations'));

alter table public.support_notifications add column if not exists role text;
update public.support_notifications set role = 'customer-success' where role is null;
alter table public.support_notifications alter column role set not null;
alter table public.support_notifications drop constraint if exists support_notifications_user_id_order_id_key;
alter table public.support_notifications add constraint support_notifications_user_order_role_key unique(user_id,order_id,role);
