-- Canonical intelligence, safety, execution and learning layer for Marketing Manager.
create table if not exists public.marketing_operator_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  objective text not null default 'profitable_revenue' check (objective in ('profitable_revenue','revenue_growth','customer_lifetime_value')),
  timezone text not null default 'UTC', quiet_start time not null default '19:00', quiet_end time not null default '09:00',
  default_margin_percent numeric check (default_margin_percent between 0 and 100), max_discount_percent numeric not null default 15 check (max_discount_percent between 0 and 100),
  max_marketing_contacts_7d integer not null default 3 check (max_marketing_contacts_7d between 1 and 14),
  max_broadcast_contacts_7d integer not null default 1 check (max_broadcast_contacts_7d between 0 and 7),
  max_winback_contacts_30d integer not null default 2 check (max_winback_contacts_30d between 0 and 8),
  brand_voice text not null default '', forbidden_phrases text[] not null default '{}', excluded_product_ids text[] not null default '{}',
  review_destination text, approval_alerts boolean not null default true, daily_digest boolean not null default true,
  setup_complete boolean not null default false, version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.marketing_opportunities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('recovery','winback','review','broadcast','restock','launch','overstock','retention_risk')),
  fingerprint text not null, status text not null default 'detected' check (status in ('detected','scored','proposed','dismissed','expired','converted')),
  evidence jsonb not null default '{}', score numeric not null default 0, confidence numeric not null default 0 check (confidence between 0 and 1),
  expected_revenue_low numeric, expected_revenue_high numeric, expected_profit_low numeric, expected_profit_high numeric,
  rationale text not null default '', expires_at timestamptz, last_validated_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,kind,fingerprint)
);

create table if not exists public.marketing_activities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references public.marketing_opportunities(id) on delete set null,
  kind text not null check (kind in ('recovery','winback','review','broadcast')),
  legacy_table text, legacy_id uuid, status text not null default 'proposed' check (status in ('proposed','approved','scheduled','executing','paused','completed','rejected','expired','blocked','failed')),
  title text not null, audience jsonb not null default '{}', strategy jsonb not null default '{}', evidence jsonb not null default '{}', safety_snapshot jsonb not null default '{}',
  expected_revenue_low numeric, expected_revenue_high numeric, expected_profit_low numeric, expected_profit_high numeric, confidence numeric not null default 0,
  profile_version integer, approval_version integer not null default 1, approved_at timestamptz, expires_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(legacy_table,legacy_id)
);

create table if not exists public.marketing_activity_variants (
  id uuid primary key default gen_random_uuid(), activity_id uuid not null references public.marketing_activities(id) on delete cascade,
  label text not null, subject text not null, body text not null, allocation_percent numeric not null default 45 check (allocation_percent between 0 and 100),
  is_holdout boolean not null default false, status text not null default 'prepared' check (status in ('prepared','testing','winner','loser','inconclusive')),
  delivered integer not null default 0, conversions integer not null default 0, attributed_revenue numeric not null default 0,
  created_at timestamptz not null default now(), unique(activity_id,label)
);

create table if not exists public.marketing_contact_ledger (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  contact_key text not null, activity_id uuid references public.marketing_activities(id) on delete set null,
  campaign_kind text not null, event text not null check (event in ('reserved','sent','skipped','unsubscribed','bounced','complained','converted')),
  occurred_at timestamptz not null default now(), detail jsonb not null default '{}'
);
create table if not exists public.marketing_global_suppressions (
  user_id uuid not null references auth.users(id) on delete cascade, contact_key text not null, reason text not null,
  source text not null, created_at timestamptz not null default now(), primary key(user_id,contact_key)
);

create table if not exists public.marketing_attribution_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid references public.marketing_activities(id) on delete set null, variant_id uuid references public.marketing_activity_variants(id) on delete set null,
  contact_key text, event_type text not null check (event_type in ('delivered','opened','clicked','ordered','recovered','reviewed','unsubscribed','bounced','complained')),
  external_id text, attribution_method text not null default 'direct', confidence numeric not null default 1 check (confidence between 0 and 1),
  revenue numeric, gross_profit numeric, currency text, occurred_at timestamptz not null default now(), detail jsonb not null default '{}',
  unique(user_id,event_type,external_id,activity_id)
);

create table if not exists public.marketing_decision_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  trigger text not null, input_snapshot jsonb not null default '{}', candidates jsonb not null default '[]', selected_opportunity_id uuid references public.marketing_opportunities(id) on delete set null,
  model text, prompt_version text, outcome text not null, error text, started_at timestamptz not null default now(), completed_at timestamptz
);

create table if not exists public.marketing_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  kind text not null, payload jsonb not null default '{}', status text not null default 'queued' check (status in ('queued','leased','completed','failed','dead')),
  priority integer not null default 100, run_at timestamptz not null default now(), lease_owner text, lease_until timestamptz,
  attempt_count integer not null default 0, max_attempts integer not null default 5, last_error text,
  idempotency_key text not null unique, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.marketing_worker_heartbeats (
  worker text primary key, last_started_at timestamptz, last_succeeded_at timestamptz, last_failed_at timestamptz,
  last_error text, processed integer not null default 0, updated_at timestamptz not null default now()
);
create table if not exists public.marketing_notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid references public.marketing_activities(id) on delete cascade, kind text not null, status text not null default 'pending' check (status in ('pending','sent','read','failed')),
  title text not null, message text not null, email_sent_at timestamptz, created_at timestamptz not null default now(), unique(user_id,activity_id,kind)
);

create index if not exists marketing_opportunities_user_status on public.marketing_opportunities(user_id,status,score desc);
create index if not exists marketing_activities_user_status on public.marketing_activities(user_id,status,created_at desc);
create index if not exists marketing_contact_recent on public.marketing_contact_ledger(user_id,contact_key,occurred_at desc);
create index if not exists marketing_jobs_due on public.marketing_jobs(status,run_at,priority);
create index if not exists marketing_attribution_activity on public.marketing_attribution_events(activity_id,occurred_at);

alter table public.marketing_operator_profiles enable row level security;
alter table public.marketing_opportunities enable row level security; alter table public.marketing_activities enable row level security;
alter table public.marketing_activity_variants enable row level security; alter table public.marketing_contact_ledger enable row level security;
alter table public.marketing_global_suppressions enable row level security; alter table public.marketing_attribution_events enable row level security;
alter table public.marketing_decision_runs enable row level security; alter table public.marketing_jobs enable row level security;
alter table public.marketing_worker_heartbeats enable row level security; alter table public.marketing_notifications enable row level security;

create policy "owners manage own marketing profile" on public.marketing_operator_profiles for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "owners read own marketing opportunities" on public.marketing_opportunities for select to authenticated using(auth.uid()=user_id);
create policy "owners read own marketing activities" on public.marketing_activities for select to authenticated using(auth.uid()=user_id);
create policy "owners read own marketing variants" on public.marketing_activity_variants for select to authenticated using(exists(select 1 from public.marketing_activities a where a.id=activity_id and a.user_id=auth.uid()));
create policy "owners read own contact history" on public.marketing_contact_ledger for select to authenticated using(auth.uid()=user_id);
create policy "owners read own suppressions" on public.marketing_global_suppressions for select to authenticated using(auth.uid()=user_id);
create policy "owners read own attribution" on public.marketing_attribution_events for select to authenticated using(auth.uid()=user_id);
create policy "owners read own decisions" on public.marketing_decision_runs for select to authenticated using(auth.uid()=user_id);
create policy "owners read own notifications" on public.marketing_notifications for select to authenticated using(auth.uid()=user_id);

create or replace function public.bump_marketing_profile_version() returns trigger language plpgsql as $$ begin new.version=old.version+1;new.updated_at=now();return new;end $$;
drop trigger if exists marketing_profile_version on public.marketing_operator_profiles;
create trigger marketing_profile_version before update on public.marketing_operator_profiles for each row execute function public.bump_marketing_profile_version();

revoke insert,update,delete on public.marketing_opportunities,public.marketing_activities,public.marketing_activity_variants,public.marketing_contact_ledger,public.marketing_global_suppressions,public.marketing_attribution_events,public.marketing_decision_runs,public.marketing_jobs,public.marketing_worker_heartbeats,public.marketing_notifications from authenticated;

create or replace function public.claim_marketing_jobs(p_worker text,p_limit integer default 25)
returns setof public.marketing_jobs language plpgsql security definer set search_path=public as $$
begin
  return query update public.marketing_jobs j set status='leased',lease_owner=p_worker,lease_until=now()+interval '5 minutes',attempt_count=j.attempt_count+1,updated_at=now()
  where j.id in (select id from public.marketing_jobs where (status='queued' or (status='leased' and lease_until<now())) and run_at<=now() order by priority asc,run_at asc for update skip locked limit greatest(1,least(p_limit,100))) returning j.*;
end $$;
revoke all on function public.claim_marketing_jobs(text,integer) from public,anon,authenticated;

create or replace function public.reserve_marketing_contact(p_user uuid,p_contact text,p_kind text,p_activity uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.marketing_operator_profiles%rowtype; local_time time; total_7d integer; kind_count integer; reservation uuid;
begin
  if exists(select 1 from public.marketing_global_suppressions where user_id=p_user and contact_key=p_contact) then return jsonb_build_object('allowed',false,'reason','suppressed'); end if;
  select * into p from public.marketing_operator_profiles where user_id=p_user;
  if not found then p.timezone:='UTC';p.quiet_start:='19:00';p.quiet_end:='09:00';p.max_marketing_contacts_7d:=3;p.max_broadcast_contacts_7d:=1;p.max_winback_contacts_30d:=2;end if;
  begin local_time:=(now() at time zone p.timezone)::time; exception when others then local_time:=(now() at time zone 'UTC')::time; end;
  if (p.quiet_start>p.quiet_end and (local_time>=p.quiet_start or local_time<p.quiet_end)) or (p.quiet_start<p.quiet_end and local_time>=p.quiet_start and local_time<p.quiet_end) or p.quiet_start=p.quiet_end then return jsonb_build_object('allowed',false,'reason','quiet_hours'); end if;
  select count(*) into total_7d from public.marketing_contact_ledger where user_id=p_user and contact_key=p_contact and event in ('reserved','sent') and occurred_at>=now()-interval '7 days';
  if total_7d>=p.max_marketing_contacts_7d then return jsonb_build_object('allowed',false,'reason','global_frequency_limit'); end if;
  if p_kind='broadcast' then select count(*) into kind_count from public.marketing_contact_ledger where user_id=p_user and contact_key=p_contact and campaign_kind='broadcast' and event in ('reserved','sent') and occurred_at>=now()-interval '7 days';
    if kind_count>=p.max_broadcast_contacts_7d then return jsonb_build_object('allowed',false,'reason','broadcast_frequency_limit'); end if;
  elsif p_kind='winback' then select count(*) into kind_count from public.marketing_contact_ledger where user_id=p_user and contact_key=p_contact and campaign_kind='winback' and event in ('reserved','sent') and occurred_at>=now()-interval '30 days';
    if kind_count>=p.max_winback_contacts_30d then return jsonb_build_object('allowed',false,'reason','winback_frequency_limit'); end if;
  end if;
  if p_kind='broadcast' and exists(select 1 from public.marketing_contact_ledger where user_id=p_user and contact_key=p_contact and campaign_kind='recovery' and event in ('reserved','sent') and occurred_at>=now()-interval '72 hours') then return jsonb_build_object('allowed',false,'reason','recovery_priority'); end if;
  insert into public.marketing_contact_ledger(user_id,contact_key,activity_id,campaign_kind,event) values(p_user,p_contact,p_activity,p_kind,'reserved') returning id into reservation;
  return jsonb_build_object('allowed',true,'reservationId',reservation);
end $$;
revoke all on function public.reserve_marketing_contact(uuid,text,text,uuid) from public,anon,authenticated;

create or replace function public.increment_marketing_variant(p_variant uuid,p_event text,p_revenue numeric default 0) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_event='delivered' then update public.marketing_activity_variants set delivered=delivered+1,status='testing' where id=p_variant;
  elsif p_event='converted' then update public.marketing_activity_variants set conversions=conversions+1,attributed_revenue=attributed_revenue+greatest(0,coalesce(p_revenue,0)),status='testing' where id=p_variant;
  end if;
end $$;
revoke all on function public.increment_marketing_variant(uuid,text,numeric) from public,anon,authenticated;
