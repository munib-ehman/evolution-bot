begin;

create table public.network_analytics_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.network_analytics_admins enable row level security;
revoke all on public.network_analytics_admins from anon, authenticated;

create function public.network_is_analytics_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.network_analytics_admins where user_id = auth.uid());
$$;
revoke all on function public.network_is_analytics_admin() from public, anon;
grant execute on function public.network_is_analytics_admin() to authenticated;

create table public.network_events (
  id uuid primary key,
  event_name text not null check (event_name in ('feed_view', 'post_view', 'post_open', 'form_start', 'form_close', 'agent_reuse', 'logo_picker_open', 'logo_added', 'logo_removed', 'login_click', 'login_request', 'login_sent', 'login_success', 'login_error', 'publish_click', 'form_validation_error', 'publish_attempt', 'publish_success', 'publish_error', 'feed_error', 'checkout_click')),
  visitor_id uuid not null,
  session_id uuid not null,
  flow_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  post_id uuid references public.network_posts(id) on delete set null,
  agent_id uuid references public.network_agents(id) on delete set null,
  seller_id uuid references auth.users(id) on delete set null,
  demo_key text check (demo_key in ('signal-example', 'scout-example', 'echo-example')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index network_events_received on public.network_events(received_at);
create index network_events_visitor_time on public.network_events(visitor_id, received_at);
create index network_events_actor_time on public.network_events(actor_id, received_at);
create index network_events_seller on public.network_events(seller_id, received_at);
create unique index network_events_feed_once on public.network_events(session_id) where event_name = 'feed_view';
create unique index network_events_publish_once on public.network_events(post_id) where event_name = 'publish_success';
create unique index network_events_post_once on public.network_events(session_id, (coalesce(post_id::text, demo_key))) where event_name = 'post_view';
alter table public.network_events enable row level security;
revoke all on public.network_events from anon, authenticated;
grant select on public.network_events to authenticated;
create policy network_events_private_read on public.network_events for select to authenticated using (
  seller_id = (select auth.uid()) or actor_id = (select auth.uid()) or (select public.network_is_analytics_admin())
);

create function public.network_record_event(event_input jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  name text := event_input->>'name';
  visitor uuid := (event_input->>'visitorId')::uuid;
  event_id uuid := (event_input->>'id')::uuid;
  target_post uuid;
  target_agent uuid;
  target_seller uuid;
  demo text;
  actor uuid;
  event_time timestamptz := (event_input->>'at')::timestamptz;
begin
  if event_input is null or octet_length(event_input::text) > 2048 then raise exception 'Invalid event'; end if;
  if name is null or name not in ('feed_view', 'post_view', 'post_open', 'form_start', 'form_close', 'agent_reuse', 'logo_picker_open', 'logo_added', 'logo_removed', 'login_click', 'login_request', 'login_sent', 'login_success', 'login_error', 'publish_click', 'form_validation_error', 'publish_attempt', 'publish_success', 'publish_error', 'feed_error', 'checkout_click') then raise exception 'Invalid event name'; end if;
  if event_time is null or event_time > now() + interval '5 minutes' or event_time < now() - interval '90 days' then raise exception 'Invalid event time'; end if;
  if exists(select 1 from public.network_events where id = event_id) then return; end if;
  perform pg_advisory_xact_lock(hashtext(visitor::text));
  if (select count(*) from public.network_events where visitor_id = visitor and received_at > now() - interval '1 minute') >= 180 then raise exception 'Event rate limit'; end if;
  if auth.uid() is not null and (select count(*) from public.network_events where actor_id = auth.uid() and received_at > now() - interval '1 minute') >= 500 then raise exception 'Account event rate limit'; end if;
  if event_input->>'actorId' is not null and (event_input->>'actorId')::uuid = auth.uid() then actor := auth.uid(); end if;
  if event_input->>'postId' in ('signal-example', 'scout-example', 'echo-example') then demo := event_input->>'postId';
  elsif event_input->>'postId' is not null then
    target_post := (event_input->>'postId')::uuid;
    select post.agent_id, post.seller_id into target_agent, target_seller from public.network_posts post where post.id = target_post;
    if not found then raise exception 'Unknown post'; end if;
  end if;
  if name in ('post_view', 'checkout_click', 'publish_success') and target_post is null and demo is null then raise exception 'Post required'; end if;
  if name = 'publish_success' and (actor is null or target_seller is distinct from actor) then raise exception 'Only the publisher can report publication'; end if;
  if name = 'checkout_click' and demo is not null then raise exception 'Demo has no checkout'; end if;
  insert into public.network_events(id, event_name, visitor_id, session_id, flow_id, actor_id, post_id, agent_id, seller_id, demo_key, occurred_at)
  values(event_id, name, visitor, (event_input->>'sessionId')::uuid, (event_input->>'flowId')::uuid, actor, target_post, target_agent, target_seller, demo, event_time)
  on conflict do nothing;
  delete from public.network_events where id in (select id from public.network_events where received_at < now() - interval '90 days' limit 100);
end;
$$;
revoke all on function public.network_record_event(jsonb) from public;
grant execute on function public.network_record_event(jsonb) to anon, authenticated;

create function public.network_analytics_report() returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare report jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view analytics'; end if;
  with visible as (select * from public.network_events where occurred_at >= now() - interval '30 days'),
  counts as (select event_name as name, count(*) as total, count(distinct visitor_id) as visitors from visible group by event_name),
  per_agent as (
    select coalesce(agent.name, event.demo_key) as agent,
    count(*) filter(where event.event_name = 'post_view') as views,
    count(*) filter(where event.event_name = 'checkout_click') as clicks
    from visible event left join public.network_agents agent on agent.id = event.agent_id
    where event.agent_id is not null or event.demo_key is not null group by event.agent_id, agent.name, event.demo_key
  ),
  journey as (
    select event.id, event.occurred_at as at, event.event_name as name, event.actor_id as "actorId", event.visitor_id as "visitorId",
    case when event.actor_id is not null then 'Account ' || left(event.actor_id::text, 8) else 'Visitor ' || left(event.visitor_id::text, 8) end as actor,
    coalesce(agent.name, event.demo_key) as agent, agent.builder_name as seller, event.session_id as session, event.flow_id as flow
    from visible event left join public.network_agents agent on agent.id = event.agent_id order by event.received_at desc limit 100
  )
  select jsonb_build_object(
    'scope', case when public.network_is_analytics_admin() then 'Private owner view · all observed activity' else 'Private seller view · your agents and account activity' end,
    'counts', coalesce((select jsonb_agg(counts) from counts), '[]'::jsonb),
    'agents', coalesce((select jsonb_agg(per_agent) from per_agent), '[]'::jsonb),
    'journey', coalesce((select jsonb_agg(journey) from journey), '[]'::jsonb)
  ) into report;
  return report;
end;
$$;
revoke all on function public.network_analytics_report() from public, anon;
grant execute on function public.network_analytics_report() to authenticated;

commit;
