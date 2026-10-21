begin;

create table public.network_agents (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  name_key text generated always as (lower(btrim(name))) stored,
  builder_name text not null check (length(btrim(builder_name)) between 1 and 80),
  audience text not null check (length(btrim(audience)) between 1 and 140),
  deliverable text not null check (length(btrim(deliverable)) between 1 and 180),
  price numeric not null check (price between 0 and 1000000 and price = round(price, 2)),
  currency text not null check (currency in ('USD', 'EUR', 'GBP', 'PKR')),
  seller_reported_hires integer not null default 0 check (seller_reported_hires between 0 and 1000000000),
  checkout_url text not null check (length(checkout_url) <= 2048 and checkout_url ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'),
  autonomy_claimed boolean not null check (autonomy_claimed),
  color text not null default 'lavender' check (color in ('sage', 'clay', 'lavender')),
  created_at timestamptz not null default now(),
  unique (seller_id, name_key)
);

create table public.network_posts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.network_agents(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  task text not null check (length(btrim(task)) between 1 and 1000),
  result text not null check (length(btrim(result)) between 1 and 1400),
  created_at timestamptz not null default now()
);

create index network_posts_newest on public.network_posts (created_at desc);
create index network_posts_agent on public.network_posts (agent_id);
alter table public.network_agents enable row level security;
alter table public.network_posts enable row level security;

create policy network_agents_read on public.network_agents for select to anon, authenticated using (true);
create policy network_agents_insert on public.network_agents for insert to authenticated with check (seller_id = (select auth.uid()));
create policy network_agents_update on public.network_agents for update to authenticated using (seller_id = (select auth.uid())) with check (seller_id = (select auth.uid()));
create policy network_posts_read on public.network_posts for select to anon, authenticated using (true);
create policy network_posts_insert on public.network_posts for insert to authenticated with check (
  seller_id = (select auth.uid()) and exists (
    select 1 from public.network_agents agent where agent.id = agent_id and agent.seller_id = (select auth.uid())
  )
);

revoke all on public.network_agents, public.network_posts from anon, authenticated;
grant select on public.network_agents, public.network_posts to anon, authenticated;
grant insert, update on public.network_agents to authenticated;
grant insert on public.network_posts to authenticated;

create function public.network_publish_post(draft jsonb) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  current_seller uuid := auth.uid();
  current_agent uuid;
  new_post uuid;
begin
  if current_seller is null then raise exception 'Sign in to publish'; end if;
  if coalesce(draft->>'sellerReportedHires', '') !~ '^[0-9]{1,10}$' then raise exception 'Invalid hire count'; end if;
  insert into public.network_agents (seller_id, name, builder_name, audience, deliverable, price, currency, seller_reported_hires, checkout_url, autonomy_claimed)
  values (current_seller, btrim(draft->>'agent'), btrim(draft->>'owner'), btrim(draft->>'audience'), btrim(draft->>'role'), (draft->>'price')::numeric, draft->>'currency', (draft->>'sellerReportedHires')::integer, draft->>'checkoutUrl', (draft->>'autonomyClaimed')::boolean)
  on conflict (seller_id, name_key) do update set builder_name = excluded.builder_name, audience = excluded.audience, deliverable = excluded.deliverable, price = excluded.price, currency = excluded.currency, seller_reported_hires = excluded.seller_reported_hires, checkout_url = excluded.checkout_url, autonomy_claimed = excluded.autonomy_claimed
  returning id into current_agent;
  insert into public.network_posts (agent_id, seller_id, task, result)
  values (current_agent, current_seller, btrim(draft->>'text'), btrim(draft->>'sample')) returning id into new_post;
  return new_post;
end;
$$;

revoke all on function public.network_publish_post(jsonb) from public, anon;
grant execute on function public.network_publish_post(jsonb) to authenticated;

commit;
