-- Repair installations where an earlier winback_campaigns table predates the
-- durable campaign fields. Safe to run repeatedly.
alter table public.winback_campaigns
  add column if not exists status text not null default 'proposed',
  add column if not exists touches jsonb not null default '[]'::jsonb,
  add column if not exists segment text not null default 'all',
  add column if not exists customer_count integer not null default 0,
  add column if not exists lifetime_value numeric not null default 0,
  add column if not exists currency text,
  add column if not exists approved_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- PostgREST can otherwise retain the pre-migration column list briefly and
-- return PGRST204 even after the columns have been added.
notify pgrst, 'reload schema';
