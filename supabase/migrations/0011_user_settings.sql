-- User settings: profile, language/timezone, target roles
-- Add new columns to profiles table

alter table public.profiles 
add column if not exists target_roles text[] default '{}'::text[],
add column if not exists language text default 'en',
add column if not exists timezone text default 'UTC',
add column if not exists email_notifications boolean default true;

-- Add index for target_roles GIN index
create index if not exists profiles_target_roles_idx on public.profiles using gin(target_roles);

-- Create user_settings table for additional settings
create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  language text not null default 'en',
  timezone text not null default 'UTC',
  email_notifications boolean not null default true,
  marketing_emails boolean not null default false,
  two_factor_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trigger to keep updated_at fresh
drop trigger if exists set_user_settings_updated_at on public.user_settings;
create trigger set_user_settings_updated_at
before update on public.user_settings
for each row execute procedure public.set_updated_at();

alter table public.user_settings enable row level security;

create policy "user_settings_crud_own" on public.user_settings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index if not exists user_settings_user_id_idx on public.user_settings(user_id);

-- Note: target_roles stays in profiles table for simplicity
-- We can query it directly or join from user_settings
