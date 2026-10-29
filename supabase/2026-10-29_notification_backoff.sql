begin;
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
revoke all on function public.evolution_claim_mail(uuid) from public,anon,authenticated;
grant execute on function public.evolution_claim_mail(uuid) to service_role;
commit;
