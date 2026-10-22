begin;

alter table public.network_posts alter column agent_id drop not null;
alter table public.network_posts add column kind text not null default 'agent' check (kind in ('agent', 'request'));
alter table public.network_posts add column request_title text;
alter table public.network_posts add column requester_name text;
alter table public.network_posts add column response_url text;
alter table public.network_posts add constraint network_post_shape check (
  (kind = 'agent' and agent_id is not null and request_title is null and requester_name is null and response_url is null)
  or (kind = 'request' and agent_id is null and category is not null and request_title is not null and requester_name is not null and response_url is not null
    and length(btrim(request_title)) between 1 and 100
    and length(btrim(requester_name)) between 1 and 80
    and length(response_url) <= 2048 and response_url ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$')
);
create policy network_requests_insert on public.network_posts for insert to authenticated
with check (kind = 'request' and agent_id is null and seller_id = (select auth.uid()));

create function public.network_publish_request(draft jsonb) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  new_post uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to publish'; end if;
  insert into public.network_posts (seller_id, kind, task, result, category, request_title, requester_name, response_url)
  values (auth.uid(), 'request', btrim(draft->>'text'), btrim(draft->>'text'), draft->>'category', btrim(draft->>'title'), btrim(draft->>'owner'), draft->>'responseUrl') returning id into new_post;
  return new_post;
end;
$$;
revoke all on function public.network_publish_request(jsonb) from public, anon;
grant execute on function public.network_publish_request(jsonb) to authenticated;

alter table public.network_events drop constraint network_events_event_name_check;
alter table public.network_events add constraint network_events_event_name_check check (event_name in ('feed_view', 'post_view', 'post_open', 'form_start', 'form_close', 'agent_reuse', 'logo_picker_open', 'logo_added', 'logo_removed', 'login_click', 'login_request', 'login_sent', 'login_success', 'login_error', 'publish_click', 'form_validation_error', 'publish_attempt', 'publish_success', 'publish_error', 'feed_error', 'checkout_click', 'response_click'));

create or replace function public.network_record_event(event_input jsonb) returns void
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
  if name is null or name not in ('feed_view', 'post_view', 'post_open', 'form_start', 'form_close', 'agent_reuse', 'logo_picker_open', 'logo_added', 'logo_removed', 'login_click', 'login_request', 'login_sent', 'login_success', 'login_error', 'publish_click', 'form_validation_error', 'publish_attempt', 'publish_success', 'publish_error', 'feed_error', 'checkout_click', 'response_click') then raise exception 'Invalid event name'; end if;
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
  if name in ('post_view', 'checkout_click', 'response_click', 'publish_success') and target_post is null and demo is null then raise exception 'Post required'; end if;
  if name = 'publish_success' and (actor is null or target_seller is distinct from actor) then raise exception 'Only the publisher can report publication'; end if;
  if name in ('checkout_click', 'response_click') and demo is not null then raise exception 'Demo has no checkout'; end if;
  insert into public.network_events(id, event_name, visitor_id, session_id, flow_id, actor_id, post_id, agent_id, seller_id, demo_key, occurred_at)
  values(event_id, name, visitor, (event_input->>'sessionId')::uuid, (event_input->>'flowId')::uuid, actor, target_post, target_agent, target_seller, demo, event_time)
  on conflict do nothing;
  delete from public.network_events where id in (select id from public.network_events where received_at < now() - interval '90 days' limit 100);
end;
$$;

create or replace function public.network_analytics_report() returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare report jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view analytics'; end if;
  with visible as (select * from public.network_events where occurred_at >= now() - interval '30 days'),
  counts as (select event_name as name, count(*) as total, count(distinct visitor_id) as visitors from visible group by event_name),
  per_agent as (
    select coalesce(agent.name, post.request_title, event.demo_key) as agent,
    count(*) filter(where event.event_name = 'post_view') as views,
    count(*) filter(where event.event_name = 'checkout_click') as clicks
    from visible event left join public.network_agents agent on agent.id = event.agent_id left join public.network_posts post on post.id = event.post_id
    where event.post_id is not null or event.demo_key is not null group by event.agent_id, agent.name, post.request_title, event.demo_key
  ),
  journey as (
    select event.id, event.occurred_at as at, event.event_name as name, event.actor_id as "actorId", event.visitor_id as "visitorId",
    case when event.actor_id is not null then 'Account ' || left(event.actor_id::text, 8) else 'Visitor ' || left(event.visitor_id::text, 8) end as actor,
    coalesce(agent.name, post.request_title, event.demo_key) as agent, coalesce(agent.builder_name, post.requester_name) as seller, event.session_id as session, event.flow_id as flow
    from visible event left join public.network_agents agent on agent.id = event.agent_id left join public.network_posts post on post.id = event.post_id order by event.received_at desc limit 100
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
