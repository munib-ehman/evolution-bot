begin;

create table if not exists public.evolution_users (
  id uuid primary key references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  email text not null,
  role text not null check (role in ('business', 'developer')),
  email_verified boolean not null default false,
  job_notifications boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.evolution_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.evolution_users(id),
  title text not null check (length(btrim(title)) between 5 and 100),
  description text not null check (length(btrim(description)) between 40 and 1200),
  frequency text check (frequency in ('Daily', 'Weekly', 'Monthly')),
  monthly_budget numeric(12,2) check (monthly_budget > 0 and monthly_budget <= 1000000),
  status text not null default 'Open' check (status in ('Open', 'Closed')),
  created_at timestamptz not null default now(),
  legacy_post_id uuid unique references public.network_posts(id),
  check (legacy_post_id is not null or (frequency is not null and monthly_budget is not null))
);
create table if not exists public.evolution_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.evolution_jobs(id),
  developer_id uuid not null references public.evolution_users(id),
  proposal text not null check (length(btrim(proposal)) between 40 and 1000),
  created_at timestamptz not null default now(),
  unique(job_id, developer_id)
);
create table if not exists public.evolution_mail_queue (
  id uuid primary key default gen_random_uuid(),
  event_key text unique not null,
  job_id uuid not null references public.evolution_jobs(id),
  recipient_id uuid not null references public.evolution_users(id),
  subject text not null,
  body text not null,
  reply_to text,
  state text not null default 'pending' check (state in ('pending','sending','sent','failed','uncertain')),
  claimed_at timestamptz,
  provider_id text,
  created_at timestamptz not null default now()
);
create index if not exists evolution_jobs_board on public.evolution_jobs(status, created_at desc);
create index if not exists evolution_mail_pending on public.evolution_mail_queue(state, created_at);

alter table public.evolution_users enable row level security;
alter table public.evolution_jobs enable row level security;
alter table public.evolution_applications enable row level security;
alter table public.evolution_mail_queue enable row level security;

create or replace function public.evolution_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from auth.users where id = auth.uid()
    and email_confirmed_at is not null and lower(email) = 'subhanahmedansari786@gmail.com');
$$;
revoke all on function public.evolution_is_admin() from public;
grant execute on function public.evolution_is_admin() to authenticated;

drop policy if exists evolution_users_private on public.evolution_users;
create policy evolution_users_private on public.evolution_users for select to authenticated
using (id = auth.uid() or public.evolution_is_admin());
drop policy if exists evolution_jobs_read on public.evolution_jobs;
create policy evolution_jobs_read on public.evolution_jobs for select to anon, authenticated using (true);
drop policy if exists evolution_applications_private on public.evolution_applications;
create policy evolution_applications_private on public.evolution_applications for select to authenticated
using (developer_id = auth.uid() or public.evolution_is_admin()
  or exists(select 1 from public.evolution_jobs where id = job_id and business_id = auth.uid()));
revoke all on public.evolution_users, public.evolution_jobs, public.evolution_applications, public.evolution_mail_queue from anon, authenticated;
grant select on public.evolution_jobs to anon, authenticated;
grant select on public.evolution_users, public.evolution_applications to authenticated;
grant all on public.evolution_users, public.evolution_jobs, public.evolution_applications, public.evolution_mail_queue to service_role;

create or replace function public.evolution_register(display_name text, account_role text) returns public.evolution_users
language plpgsql security definer set search_path = public, pg_temp as $$
declare account public.evolution_users; verified_email text;
begin
  select lower(email) into verified_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Verify your email first'; end if;
  if account_role not in ('business','developer') or account_role is null then raise exception 'Choose an account type'; end if;
  insert into public.evolution_users(id,name,email,role,email_verified,job_notifications)
    values(auth.uid(), btrim(display_name), verified_email, account_role, true, account_role = 'developer')
    on conflict(id) do update set email = excluded.email, email_verified = true;
  select * into account from public.evolution_users where id = auth.uid();
  return account;
end;
$$;

create or replace function public.evolution_post_job(draft jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare new_job public.evolution_jobs; account public.evolution_users;
begin
  select * into account from public.evolution_users where id = auth.uid() and email_verified;
  if account.id is null or account.role <> 'business' then raise exception 'Sign in as a business to post a job'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from public.evolution_jobs where business_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then raise exception 'Daily job limit reached'; end if;
  if (draft->>'budget')::numeric <> round((draft->>'budget')::numeric,2) then raise exception 'Use at most two decimal places'; end if;
  insert into public.evolution_jobs(business_id,title,description,frequency,monthly_budget)
    values(auth.uid(),btrim(draft->>'title'),btrim(draft->>'description'),draft->>'frequency',(draft->>'budget')::numeric)
    returning * into new_job;
  insert into public.evolution_mail_queue(event_key,job_id,recipient_id,subject,body)
    select 'job:' || new_job.id || ':' || id, new_job.id,id,
      'New job: ' || new_job.title,
      new_job.title || E'\n\n' || new_job.description || E'\n\nBudget: $' || new_job.monthly_budget || '/month' || E'\nFrequency: ' || new_job.frequency || E'\n\nApply: https://www.runevolution.io/?action=apply&job=' || new_job.id || E'\n\nYou registered for new-job emails on Evolution. Manage alerts: https://www.runevolution.io/?action=alerts'
    from public.evolution_users where role = 'developer' and email_verified and job_notifications and id <> auth.uid();
  return new_job.id;
end;
$$;

create or replace function public.evolution_apply(target_job uuid, proposal_text text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare application public.evolution_applications; job public.evolution_jobs; developer public.evolution_users;
begin
  select * into developer from public.evolution_users where id = auth.uid() and email_verified;
  if developer.id is null or developer.role <> 'developer' then raise exception 'Join as a developer to apply'; end if;
  select * into job from public.evolution_jobs where id = target_job for update;
  if job.id is null or job.status <> 'Open' then raise exception 'This job is closed or unavailable'; end if;
  if job.business_id = auth.uid() then raise exception 'You cannot apply to your own job'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from public.evolution_applications where developer_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then raise exception 'Daily application limit reached'; end if;
  insert into public.evolution_applications(job_id,developer_id,proposal)
    values(target_job,auth.uid(),btrim(proposal_text)) returning * into application;
  insert into public.evolution_mail_queue(event_key,job_id,recipient_id,subject,body,reply_to)
    values('application:' || application.id,job.id,job.business_id,'Application: ' || job.title,
      'Job: ' || job.title || E'\n\nDeveloper: ' || developer.name || E'\nEmail: ' || developer.email || E'\n\nProposal:\n' || application.proposal || E'\n\nReply to this email to contact the developer directly. Evolution only makes the connection.',developer.email);
  return application.id;
exception when unique_violation then raise exception 'You have already applied to this job';
end;
$$;

create or replace function public.evolution_close_job(target_job uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.evolution_jobs set status = 'Closed' where id = target_job and (business_id = auth.uid() or public.evolution_is_admin());
  if not found then raise exception 'Job unavailable'; end if;
end;
$$;
create or replace function public.evolution_set_alerts(enabled boolean) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.evolution_users set job_notifications = enabled where id = auth.uid() and role = 'developer';
$$;

create or replace function public.evolution_claim_mail(actor uuid default null) returns setof public.evolution_mail_queue
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.evolution_mail_queue set state='uncertain' where state='sending' and claimed_at < now() - interval '10 minutes';
  return query with candidates as (
    select mail.id from public.evolution_mail_queue mail join public.evolution_jobs job on job.id=mail.job_id
    join public.evolution_users recipient on recipient.id=mail.recipient_id
    where mail.state='pending' and (mail.claimed_at is null or mail.claimed_at < now() - interval '5 minutes')
    and (actor is null or job.business_id=actor or exists(
      select 1 from public.evolution_applications application where 'application:' || application.id=mail.event_key and application.developer_id=actor))
    and (mail.event_key not like 'job:%' or (recipient.job_notifications and job.status='Open'))
    order by mail.created_at,mail.id for update of mail skip locked limit 20
  ) update public.evolution_mail_queue mail set state='sending',claimed_at=now() from candidates where mail.id=candidates.id returning mail.*;
end;
$$;

revoke all on function public.evolution_register(text,text),public.evolution_post_job(jsonb),public.evolution_apply(uuid,text),public.evolution_close_job(uuid),public.evolution_set_alerts(boolean),public.evolution_claim_mail(uuid) from public,anon;
grant execute on function public.evolution_register(text,text),public.evolution_post_job(jsonb),public.evolution_apply(uuid,text),public.evolution_close_job(uuid),public.evolution_set_alerts(boolean) to authenticated;
revoke all on function public.evolution_claim_mail(uuid) from authenticated;
grant execute on function public.evolution_claim_mail(uuid) to service_role;

insert into public.evolution_users(id,name,email,role,email_verified)
  select distinct on (account.id) account.id,coalesce(nullif(btrim(post.requester_name),''),'Business'),lower(account.email),'business',account.email_confirmed_at is not null
  from public.network_posts post join auth.users account on account.id=post.seller_id where post.kind='request'
  order by account.id,post.created_at on conflict(id) do nothing;
insert into public.evolution_jobs(id,business_id,title,description,frequency,monthly_budget,created_at,legacy_post_id)
  select id,seller_id,request_title,task,null,null,created_at,id from public.network_posts where kind='request'
  on conflict(legacy_post_id) do nothing;

commit;
