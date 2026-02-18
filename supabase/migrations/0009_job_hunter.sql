-- Job Hunter Module: jobs and job_applications tables
-- Kanban pipeline: Saved → Applied → OA → Interview → Offer/Reject

-- Jobs table (job listings)
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_source text,
  external_id text,
  company text not null,
  title text not null,
  location text,
  remote_type text,
  salary_min int,
  salary_max int,
  job_description text,
  requirements jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  job_url text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at
before update on public.jobs
for each row execute procedure public.set_updated_at();

alter table public.jobs enable row level security;

create policy "jobs_crud_own" on public.jobs
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Job applications table (tracking)
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  stage text not null default 'saved' check (stage in ('saved', 'applied', 'oa', 'interview', 'offer', 'rejected')),
  status text not null default 'active' check (status in ('active', 'archived')),
  applied_at timestamptz,
  next_followup_at timestamptz,
  notes text,
  company text,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_job_applications_updated_at on public.job_applications;
create trigger set_job_applications_updated_at
before update on public.job_applications
for each row execute procedure public.set_updated_at();

alter table public.job_applications enable row level security;

create policy "job_applications_crud_own" on public.job_applications
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Indexes
create index if not exists jobs_user_id_created_at_idx on public.jobs(user_id, created_at desc);
create index if not exists jobs_company_title_idx on public.jobs(company, title);
create index if not exists job_applications_user_id_stage_idx on public.job_applications(user_id, stage, updated_at desc);
create index if not exists job_applications_job_id_idx on public.job_applications(job_id);
