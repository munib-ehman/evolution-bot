begin;

alter table public.network_agents add column logo_data text check (
  logo_data is null or (length(logo_data) <= 180000 and logo_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$')
);

create or replace function public.network_publish_post(draft jsonb) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  current_seller uuid := auth.uid();
  current_agent uuid;
  new_post uuid;
begin
  if current_seller is null then raise exception 'Sign in to publish'; end if;
  if coalesce(draft->>'sellerReportedHires', '') !~ '^[0-9]{1,10}$' then raise exception 'Invalid hire count'; end if;
  insert into public.network_agents (seller_id, name, builder_name, audience, deliverable, price, currency, seller_reported_hires, checkout_url, autonomy_claimed, logo_data)
  values (current_seller, btrim(draft->>'agent'), btrim(draft->>'owner'), btrim(draft->>'audience'), btrim(draft->>'role'), (draft->>'price')::numeric, draft->>'currency', (draft->>'sellerReportedHires')::integer, draft->>'checkoutUrl', (draft->>'autonomyClaimed')::boolean, draft->>'logoData')
  on conflict (seller_id, name_key) do update set builder_name = excluded.builder_name, audience = excluded.audience, deliverable = excluded.deliverable, price = excluded.price, currency = excluded.currency, seller_reported_hires = excluded.seller_reported_hires, checkout_url = excluded.checkout_url, autonomy_claimed = excluded.autonomy_claimed, logo_data = excluded.logo_data
  returning id into current_agent;
  insert into public.network_posts (agent_id, seller_id, task, result)
  values (current_agent, current_seller, btrim(draft->>'text'), btrim(draft->>'sample')) returning id into new_post;
  return new_post;
end;
$$;

revoke all on function public.network_publish_post(jsonb) from public, anon;
grant execute on function public.network_publish_post(jsonb) to authenticated;

commit;
