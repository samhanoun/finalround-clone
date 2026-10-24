-- Cover Letter Generator - Database Schema
-- Add: job_postings + cover_letters tables + RLS + indexes
--
-- Job postings live in their own table: `public.jobs` (0001_init) is the
-- background-job queue used by /api/llm and interview reports.
create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_source text,
  external_id text,
  company text not null,
  title text not null,
  location text,
  remote_type text,
  salary_range text,
  salary_min int,
  salary_max int,
  job_description text,
  requirements jsonb not null default '[]'::jsonb,
  job_url text,
  metadata jsonb not null default '{}'::jsonb,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_job_postings_updated_at on public.job_postings;
create trigger set_job_postings_updated_at
before update on public.job_postings
for each row execute procedure public.set_updated_at();

alter table public.job_postings enable row level security;

create policy "job_postings_crud_own" on public.job_postings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index if not exists job_postings_user_id_created_at_idx
  on public.job_postings(user_id, created_at desc);

create index if not exists job_postings_company_title_idx
  on public.job_postings(company, title);

create table if not exists public.cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.job_postings(id) on delete set null,
  resume_id uuid references public.resume_assets(id) on delete set null,
  title text,
  content text,
  tone text not null default 'professional' check (tone in ('professional', 'friendly', 'formal', 'casual', 'confident')),
  status text not null default 'draft' check (status in ('draft', 'generated', 'saved', 'exported')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_cover_letters_updated_at on public.cover_letters;
create trigger set_cover_letters_updated_at
before update on public.cover_letters
for each row execute procedure public.set_updated_at();

alter table public.cover_letters enable row level security;

create policy "cover_letters_crud_own" on public.cover_letters
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index if not exists cover_letters_user_id_created_at_idx
  on public.cover_letters(user_id, created_at desc);

create index if not exists cover_letters_user_id_status_idx
  on public.cover_letters(user_id, status);
