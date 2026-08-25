-- Durable, merchant-owned memory for the role agents. This stores only
-- explicit business preferences and decisions; customer PII belongs in
-- Shopify and must never be copied here as conversational memory.
create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('brand', 'audience', 'campaign', 'policy', 'preference', 'business')),
  content text not null check (char_length(content) between 1 and 500),
  source text not null default 'explicit_chat' check (source in ('explicit_chat', 'merchant_settings', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, content)
);

create index if not exists agent_memories_user_updated
  on public.agent_memories (user_id, updated_at desc);

alter table public.agent_memories enable row level security;

create policy "Users can read own agent memories"
  on public.agent_memories for select
  using (auth.uid() = user_id);

create policy "Users can insert own agent memories"
  on public.agent_memories for insert
  with check (auth.uid() = user_id);

create policy "Users can update own agent memories"
  on public.agent_memories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own agent memories"
  on public.agent_memories for delete
  using (auth.uid() = user_id);

