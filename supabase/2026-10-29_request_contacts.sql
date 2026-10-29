begin;

alter table public.evolution_jobs
  add column if not exists requester_name text check (length(btrim(requester_name)) between 1 and 80),
  add column if not exists contact_email text check (length(contact_email) <= 254 and contact_email ~ '^[A-Za-z0-9._%+!-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$'),
  add column if not exists contact_linkedin text check (length(contact_linkedin) <= 500 and contact_linkedin ~ '^https://(www\.)?linkedin\.com/(in|company)/[A-Za-z0-9%_-]+/?$'),
  add column if not exists contact_x text check (contact_x ~ '^https://(www\.)?(x|twitter)\.com/[A-Za-z0-9_]{1,15}/?$' and contact_x !~* '^https://(www\.)?(x|twitter)\.com/(home|login|settings|messages|search|explore)/?$'),
  add column if not exists contact_url text check (length(contact_url) <= 500 and contact_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}([/?#][^[:space:]]*)?$');

update public.evolution_jobs request
set requester_name = nullif(btrim(post.requester_name), '')
from public.network_posts post
where request.legacy_post_id = post.id and request.requester_name is null
  and length(btrim(post.requester_name)) between 1 and 80;

do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='network_posts' and column_name='response_url') then
    execute $copy$
      update public.evolution_jobs request
      set contact_url = post.response_url
      from public.network_posts post
      where request.legacy_post_id = post.id and request.contact_url is null
        and length(post.response_url) <= 500
        and post.response_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}([/?#][^[:space:]]*)?$'
    $copy$;
  end if;
end;
$$;

create or replace function public.evolution_post_job(draft jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare new_job public.evolution_jobs; account public.evolution_users;
  public_name text := nullif(btrim(draft->>'requester_name'), '');
  public_email text := nullif(lower(btrim(draft->>'contact_email')), '');
  linkedin text := nullif(btrim(draft->>'contact_linkedin'), '');
  social_x text := nullif(btrim(draft->>'contact_x'), '');
  website text := nullif(btrim(draft->>'contact_url'), '');
begin
  select * into account from public.evolution_users where id = auth.uid() and email_verified;
  if account.id is null or account.role <> 'business' then raise exception 'Sign in as a business to request an agent'; end if;
  if public_name is null or length(public_name) > 80 then raise exception 'Add your public name'; end if;
  if coalesce(public_email,linkedin,social_x,website) is null then raise exception 'Add at least one public contact method'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from public.evolution_jobs where business_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then raise exception 'Daily request limit reached'; end if;
  if (draft->>'budget')::numeric <> round((draft->>'budget')::numeric,2) then raise exception 'Use at most two decimal places'; end if;
  insert into public.evolution_jobs(business_id,title,description,frequency,monthly_budget,requester_name,contact_email,contact_linkedin,contact_x,contact_url)
    values(auth.uid(),btrim(draft->>'title'),btrim(draft->>'description'),draft->>'frequency',(draft->>'budget')::numeric,public_name,public_email,linkedin,social_x,website)
    returning * into new_job;
  insert into public.evolution_mail_queue(event_key,job_id,recipient_id,subject,body)
    select 'job:' || new_job.id || ':' || id, new_job.id,id,
      'Agent request: ' || new_job.title,
      new_job.title || E'\n\n' || new_job.description || E'\n\nBudget: $' || new_job.monthly_budget || '/month' || E'\nFrequency: ' || new_job.frequency || E'\n\nView request and contact: https://www.runevolution.io/?action=apply&job=' || new_job.id || E'#request-contact\n\nYou registered for agent request emails on Evolution. Manage alerts: https://www.runevolution.io/?action=alerts'
    from public.evolution_users where role = 'developer' and email_verified and job_notifications and id <> auth.uid();
  return new_job.id;
end;
$$;

create or replace function public.evolution_apply(target_job uuid, proposal_text text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare application public.evolution_applications; request public.evolution_jobs; builder public.evolution_users;
begin
  select * into builder from public.evolution_users where id = auth.uid() and email_verified;
  if builder.id is null or builder.role <> 'developer' then raise exception 'Join as an agent builder to respond'; end if;
  select * into request from public.evolution_jobs where id = target_job for update;
  if request.id is null or request.status <> 'Open' then raise exception 'This request is closed or unavailable'; end if;
  if request.business_id = auth.uid() then raise exception 'You cannot respond to your own request'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
  if (select count(*) from public.evolution_applications where developer_id = auth.uid() and created_at > now() - interval '1 day') >= 30 then raise exception 'Daily response limit reached'; end if;
  insert into public.evolution_applications(job_id,developer_id,proposal)
    values(target_job,auth.uid(),btrim(proposal_text)) returning * into application;
  insert into public.evolution_mail_queue(event_key,job_id,recipient_id,subject,body,reply_to)
    values('application:' || application.id,request.id,request.business_id,'Agent response: ' || request.title,
      'Request: ' || request.title || E'\n\nAgent builder: ' || builder.name || E'\nEmail: ' || builder.email || E'\n\nProposal:\n' || application.proposal || E'\n\nReply to connect directly. Evolution only makes the connection.',builder.email);
  return application.id;
exception when unique_violation then raise exception 'You have already responded to this request';
end;
$$;

commit;
