-- Finalround Clone - Initial schema + RLS
-- Apply with: supabase db reset (or psql) after creating a Supabase project.

-- Enable UUID generation
create extension if not exists pgcrypto;

-- 1) profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
for select to authenticated
using (id = auth.uid());

create policy "profiles_update_own" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- 2) interviews
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Interview',
  status text not null default 'draft',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_interviews_updated_at on public.interviews;
create trigger set_interviews_updated_at
before update on public.interviews
for each row execute procedure public.set_updated_at();

alter table public.interviews enable row level security;

create policy "interviews_crud_own" on public.interviews
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 2b) interview_messages
create table if not exists public.interview_messages (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('system','user','assistant')),
  content text not null,
  tokens int,
  created_at timestamptz not null default now()
);

alter table public.interview_messages enable row level security;

create policy "interview_messages_crud_own" on public.interview_messages
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 2c) interview_scores
create table if not exists public.interview_scores (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score numeric,
  rubric jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.interview_scores enable row level security;

create policy "interview_scores_crud_own" on public.interview_scores
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 3) resume assets + runs
create table if not exists public.resume_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'resume',
  filename text,
  content_type text,
  size_bytes bigint,
  storage_path text,
  sha256 text,
  created_at timestamptz not null default now()
);

alter table public.resume_assets enable row level security;
create policy "resume_assets_crud_own" on public.resume_assets
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create table if not exists public.resume_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid references public.resume_assets(id) on delete set null,
  status text not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_resume_runs_updated_at on public.resume_runs;
create trigger set_resume_runs_updated_at
before update on public.resume_runs
for each row execute procedure public.set_updated_at();

alter table public.resume_runs enable row level security;
create policy "resume_runs_crud_own" on public.resume_runs
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 4) runs/jobs (LLM execution tracking)
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'llm',
  status text not null default 'queued',
  provider text,
  model text,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.jobs enable row level security;
create policy "jobs_crud_own" on public.jobs
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Helpful indexes
create index if not exists interviews_user_id_created_at_idx on public.interviews(user_id, created_at desc);
create index if not exists interview_messages_interview_id_created_at_idx on public.interview_messages(interview_id, created_at asc);
create index if not exists resume_runs_user_id_created_at_idx on public.resume_runs(user_id, created_at desc);
create index if not exists jobs_user_id_created_at_idx on public.jobs(user_id, created_at desc);
