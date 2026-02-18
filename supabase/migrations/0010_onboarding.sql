-- Onboarding state tracking for new users

create table if not exists public.onboarding_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  current_step text not null default 'welcome',
  completed_steps text[] not null default '{}',
  plan text,
  profile_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_onboarding_state_updated_at on public.onboarding_state;
create trigger set_onboarding_state_updated_at
before update on public.onboarding_state
for each row execute procedure public.set_updated_at();

alter table public.onboarding_state enable row level security;

create policy "onboarding_state_crud_own" on public.onboarding_state
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Add target_roles and experience to profiles table
alter table public.profiles add column if not exists target_roles text[] not null default '{}';
alter table public.profiles add column if not exists years_experience int;
alter table public.profiles add column if not exists industry text;
alter table public.profiles add column if not exists onboarding_completed boolean not null default false;
