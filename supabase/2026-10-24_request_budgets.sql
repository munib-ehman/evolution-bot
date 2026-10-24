begin;

alter table public.network_posts add column if not exists request_budget numeric(12,2);
alter table public.network_posts add constraint network_request_budget_range check (
  request_budget is null or (kind = 'request' and request_budget > 0 and request_budget <= 1000000)
);

create function public.network_validate_request_details() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.kind = 'request' then
    if new.request_budget is null then raise exception 'Enter a USD budget'; end if;
    if length(btrim(new.task)) not between 80 and 600 then raise exception 'Describe the task in 80–600 characters'; end if;
  end if;
  return new;
end;
$$;

create trigger network_request_details before insert or update on public.network_posts
for each row execute function public.network_validate_request_details();

create or replace function public.network_publish_request(draft jsonb) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  new_post uuid;
  budget numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to publish'; end if;
  budget := (draft->>'budget')::numeric;
  if budget is null or budget <= 0 or budget > 1000000 or budget <> round(budget, 2) then raise exception 'Enter a valid USD budget'; end if;
  insert into public.network_posts (seller_id, kind, task, result, category, request_title, requester_name, response_url, request_budget)
  values (auth.uid(), 'request', btrim(draft->>'text'), btrim(draft->>'text'), draft->>'category', btrim(draft->>'title'), btrim(draft->>'owner'), draft->>'responseUrl', budget) returning id into new_post;
  return new_post;
end;
$$;

commit;
