begin;

create table if not exists public.network_analytics_settings (
  singleton boolean primary key default true check (singleton),
  reset_at timestamptz not null
);
alter table public.network_analytics_settings enable row level security;
revoke all on public.network_analytics_settings from public, anon, authenticated;

create or replace function public.network_ignore_old_analytics() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.occurred_at < (select reset_at from public.network_analytics_settings where singleton) then return null; end if;
  return new;
end;
$$;
revoke all on function public.network_ignore_old_analytics() from public, anon, authenticated;
drop trigger if exists network_ignore_old_analytics on public.network_events;
create trigger network_ignore_old_analytics before insert on public.network_events
for each row execute function public.network_ignore_old_analytics();

create or replace function public.network_owner_journeys() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.network_is_analytics_admin() then raise exception 'Owner access required'; end if;
  with people as (
    select u.id, u.email, u.created_at,
      coalesce(nullif(u.raw_user_meta_data->>'full_name',''), nullif(u.raw_user_meta_data->>'name',''),
        (select coalesce(p.requester_name,a.builder_name) from public.network_posts p left join public.network_agents a on a.id=p.agent_id where p.seller_id=u.id order by p.created_at desc limit 1), 'Name not provided') as name
    from auth.users u
  ), user_rows as (
    select person.id, person.name, person.email, person.created_at as joined_at,
      (select max(e.occurred_at) from public.network_events e where e.actor_id=person.id) as last_active,
      (select count(*) from public.network_events e where e.actor_id=person.id and e.event_name in ('checkout_click','response_click')) as clicks_made,
      (select count(*) from public.network_events e join public.network_posts p on p.id=e.post_id where p.seller_id=person.id and e.event_name in ('checkout_click','response_click')) as clicks_received,
      coalesce((select jsonb_agg(item order by item.created_at desc) from (
        select p.id, p.kind, coalesce(p.request_title,a.name) as title, p.created_at,
          (select count(*) from public.network_events e where e.post_id=p.id and e.event_name='post_view') as views,
          (select count(*) from public.network_events e where e.post_id=p.id and e.event_name in ('checkout_click','response_click')) as clicks
        from public.network_posts p left join public.network_agents a on a.id=p.agent_id where p.seller_id=person.id
      ) item), '[]'::jsonb) as posts,
      coalesce((select jsonb_agg(item order by item.at desc) from (
        select * from (
          select e.id::text, e.occurred_at as at,
            case e.event_name when 'feed_view' then 'Opened the feed' when 'post_view' then 'Viewed a post' when 'post_open' then 'Opened the post form' when 'form_start' then 'Started writing a post' when 'checkout_click' then 'Clicked Hire' when 'response_click' then 'Clicked Respond' end as action,
            coalesce(p.request_title,a.name) as target, e.post_id,
            coalesce(p.requester_name,a.builder_name) as target_owner
          from public.network_events e left join public.network_posts p on p.id=e.post_id left join public.network_agents a on a.id=p.agent_id
          where e.actor_id=person.id and e.event_name in ('feed_view','post_view','post_open','form_start','checkout_click','response_click')
          union all
          select 'post:'||p.id::text, p.created_at, case when p.kind='request' then 'Posted a request' else 'Showcased an agent' end, coalesce(p.request_title,a.name), p.id, null::text
          from public.network_posts p left join public.network_agents a on a.id=p.agent_id where p.seller_id=person.id
          union all
          select 'signup:'||person.id::text, person.created_at, 'Signed up', null::text, null::uuid, null::text
        ) history order by at desc limit 100
      ) item), '[]'::jsonb) as journey
    from people person
  )
  select jsonb_build_object('generated_at',now(), 'reset_at',(select reset_at from public.network_analytics_settings where singleton),
    'users',coalesce((select jsonb_agg(user_rows order by coalesce(last_active,joined_at) desc) from user_rows),'[]'::jsonb),
    'anonymous_interactions',(select count(*) from public.network_events where actor_id is null and event_name in ('post_view','checkout_click','response_click')))
  into result;
  return result;
end;
$$;
revoke all on function public.network_owner_journeys() from public, anon;
grant execute on function public.network_owner_journeys() to authenticated;

commit;
