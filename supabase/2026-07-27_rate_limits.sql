-- Rate limiting — run once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Fixed-window counters behind /api/audit (anonymous funnel abuse) and
-- /api/chat (per-user). The API calls the rate_limit_hit RPC with the
-- service role; there are deliberately no anon/authenticated grants —
-- clients never see this table. Keys are salted SHA-256 hashes (no raw IPs
-- at rest). Windows self-reset on the next hit, so no cleanup job is
-- required; a periodic `delete from rate_limits where window_start < now()
-- - interval '2 days'` via pg_cron is a nice-to-have, not a need.

create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        int not null
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Atomic hit counter: resets the window when it has lapsed, else increments.
-- Returns true while the caller is within p_max hits per p_window_secs.
create or replace function public.rate_limit_hit(
  p_key text,
  p_window_secs int,
  p_max int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count        = case
                     when rate_limits.window_start < now() - make_interval(secs => p_window_secs)
                     then 1
                     else rate_limits.count + 1
                   end,
    window_start = case
                     when rate_limits.window_start < now() - make_interval(secs => p_window_secs)
                     then now()
                     else rate_limits.window_start
                   end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, int, int) from anon, authenticated;
