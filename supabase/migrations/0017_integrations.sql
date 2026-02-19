
-- Table for storing third-party integrations (OAuth tokens)
create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook', 'calendly')),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scopes text[],
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  unique(user_id, provider)
);

-- Trigger for updated_at
drop trigger if exists set_user_integrations_updated_at on public.user_integrations;
create trigger set_user_integrations_updated_at
before update on public.user_integrations
for each row execute procedure public.set_updated_at();

-- RLS
alter table public.user_integrations enable row level security;

create policy "user_integrations_crud_own" on public.user_integrations
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
