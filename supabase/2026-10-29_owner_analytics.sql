begin;

create table if not exists public.evolution_events (
  id uuid primary key,
  event_name text not null check (event_name in ('board_view','request_impression','request_open','request_start','offer_start','login_start','login_link_sent','signed_in','form_started','form_error','publish_click','response_click','contact_email','contact_linkedin','contact_x','contact_page','example_view','example_use','theme_change')),
  visitor_id uuid not null,
  session_id uuid not null,
  visitor_token_hash text not null,
  actor_id uuid references auth.users(id) on delete set null,
  job_id uuid references public.evolution_jobs(id) on delete set null,
  example_key text check (example_key ~ '^example-([1-9]|10)$'),
  occurred_at timestamptz not null default now()
);
create index if not exists evolution_events_actor_time on public.evolution_events(actor_id,occurred_at desc);
create index if not exists evolution_events_visitor_time on public.evolution_events(visitor_id,occurred_at desc);
create index if not exists evolution_events_job_time on public.evolution_events(job_id,occurred_at desc);
create index if not exists evolution_events_time on public.evolution_events(occurred_at desc);
alter table public.evolution_events enable row level security;
revoke all on public.evolution_events from public,anon,authenticated;

do $$
begin
  if to_regclass('public.network_events') is not null then execute 'revoke select on public.network_events from authenticated'; end if;
  if to_regprocedure('public.network_analytics_report()') is not null then execute 'revoke execute on function public.network_analytics_report() from authenticated'; end if;
end;
$$;

create or replace function public.evolution_record_event(event_input jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  event_id uuid := (event_input->>'id')::uuid;
  visitor uuid := (event_input->>'visitorId')::uuid;
  session uuid := (event_input->>'sessionId')::uuid;
  token text := event_input->>'visitorToken';
  name text := event_input->>'name';
  target uuid := nullif(event_input->>'jobId','')::uuid;
  example text := nullif(event_input->>'exampleKey','');
  actor uuid;
begin
  if event_input is null or octet_length(event_input::text)>1024 or event_input->>'consented' is distinct from 'true' then raise exception 'Invalid analytics event'; end if;
  if event_id is null or visitor is null or session is null or token is null or token !~ '^[0-9a-f-]{36}$' then raise exception 'Invalid analytics identity'; end if;
  if auth.uid() is not null and public.evolution_is_admin() then return; end if;
  select id into actor from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if target is not null and not exists(select 1 from public.evolution_jobs where id=target) then raise exception 'Unknown request'; end if;
  if name in ('request_impression','request_open','response_click','contact_email','contact_linkedin','contact_x','contact_page') and target is null then raise exception 'Request required'; end if;
  if name in ('example_view','example_use') and example is null then raise exception 'Example required'; end if;
  perform pg_advisory_xact_lock(hashtext(visitor::text));
  if (select count(*) from public.evolution_events where visitor_id=visitor and occurred_at>now()-interval '1 minute')>=180 then raise exception 'Analytics rate limit'; end if;
  if actor is not null and (select count(*) from public.evolution_events where actor_id=actor and occurred_at>now()-interval '1 minute')>=500 then raise exception 'Account analytics rate limit'; end if;
  insert into public.evolution_events(id,event_name,visitor_id,session_id,visitor_token_hash,actor_id,job_id,example_key)
    values(event_id,name,visitor,session,md5(token),actor,target,example) on conflict(id) do nothing;
  if actor is not null then
    update public.evolution_events set actor_id=actor
    where actor_id is null and visitor_id=visitor and session_id=session and visitor_token_hash=md5(token)
      and occurred_at>now()-interval '30 minutes';
  end if;
end;
$$;
revoke all on function public.evolution_record_event(jsonb) from public;
grant execute on function public.evolution_record_event(jsonb) to anon,authenticated;

create or replace function public.evolution_owner_analytics() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.evolution_is_admin() then raise exception 'Owner access required'; end if;
  with recent as (select * from public.evolution_events where occurred_at>=now()-interval '30 days'),
  people as (
    select 'user:'||account.id as key, coalesce(nullif(profile.name,''),nullif(account.raw_user_meta_data->>'evolution_name',''),'Name not provided') as name,
      account.email, profile.role,
      coalesce((select max(occurred_at) from recent where actor_id=account.id),account.last_sign_in_at,account.created_at) as last_active,
      (select count(*) from recent where actor_id=account.id) as interactions,
      (select count(*) from recent where actor_id=account.id and event_name like 'contact_%') as contact_clicks,
      (select count(*) from public.evolution_jobs where business_id=account.id) as requests,
      (select count(*) from public.evolution_applications where developer_id=account.id) as responses
    from auth.users account left join public.evolution_users profile on profile.id=account.id
    union all
    select 'visitor:'||visitor_id, 'Visitor '||left(visitor_id::text,8),null,null,max(occurred_at),count(*),count(*) filter(where event_name like 'contact_%'),0,0
    from recent where actor_id is null group by visitor_id
  )
  select jsonb_build_object('generated_at',now(),'period_days',30,
    'users',(select count(*) from auth.users),
    'requests',(select count(*) from public.evolution_jobs),
    'responses',(select count(*) from public.evolution_applications),
    'contact_clicks',(select count(*) from recent where event_name like 'contact_%'),
    'people',coalesce((select jsonb_agg(people order by last_active desc) from people),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.evolution_owner_analytics() from public,anon;
grant execute on function public.evolution_owner_analytics() to authenticated;

create or replace function public.evolution_owner_journey(person_key text,cutoff timestamptz default now(),page_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare person uuid; registered boolean; result jsonb;
begin
  if auth.uid() is null or not public.evolution_is_admin() then raise exception 'Owner access required'; end if;
  if person_key !~ '^(user|visitor):[0-9a-f-]{36}$' or cutoff is null or page_offset<0 or page_offset>100000 then raise exception 'Invalid journey selection'; end if;
  person := split_part(person_key,':',2)::uuid;
  registered := split_part(person_key,':',1)='user';
  with history as (
    select event.id::text as id,event.occurred_at as at,event.event_name as action,request.title as target,request.requester_name as target_owner,
      event.job_id,event.session_id,event.example_key
    from public.evolution_events event left join public.evolution_jobs request on request.id=event.job_id
    where (registered and event.actor_id=person) or (not registered and event.actor_id is null and event.visitor_id=person)
    union all
    select 'signup:'||id,created_at,'account_created',null,null,null::uuid,null::uuid,null
    from auth.users where registered and id=person
    union all
    select 'request:'||id,created_at,'request_published',title,requester_name,id,null::uuid,null
    from public.evolution_jobs where registered and business_id=person
    union all
    select 'response:'||application.id,application.created_at,'response_saved',request.title,request.requester_name,request.id,null::uuid,null
    from public.evolution_applications application join public.evolution_jobs request on request.id=application.job_id
    where registered and application.developer_id=person
  ), page as (select * from history where at<=cutoff order by at desc,id desc offset page_offset limit 101)
  select jsonb_build_object('cutoff',cutoff,'has_more',(select count(*)>100 from page),
    'items',coalesce((select jsonb_agg(item order by at desc,id desc) from (select * from page order by at desc,id desc limit 100) item),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.evolution_owner_journey(text,timestamptz,integer) from public,anon;
grant execute on function public.evolution_owner_journey(text,timestamptz,integer) to authenticated;

commit;
