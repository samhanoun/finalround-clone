-- MVP spec alignment: llm_settings, interview_sessions/messages/feedback, resume_documents/generations

create extension if not exists pgcrypto;

-- LLM settings per user
create table if not exists public.llm_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'openai',
  model text not null default 'gpt-4o-mini',
  temperature numeric not null default 0.2,
  max_tokens int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.llm_settings enable row level security;

create policy "llm_settings_crud_own" on public.llm_settings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Interview sessions
create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Interview',
  status text not null default 'draft',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_interview_sessions_updated_at on public.interview_sessions;
create trigger set_interview_sessions_updated_at
before update on public.interview_sessions
for each row execute procedure public.set_updated_at();

alter table public.interview_sessions enable row level security;
create policy "interview_sessions_crud_own" on public.interview_sessions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Interview messages
create table if not exists public.interview_session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('system','user','assistant')),
  content text not null,
  tokens int,
  created_at timestamptz not null default now()
);

alter table public.interview_session_messages enable row level security;
create policy "interview_session_messages_crud_own" on public.interview_session_messages
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Interview feedback (score + rubric)
create table if not exists public.interview_session_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score numeric,
  rubric jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.interview_session_feedback enable row level security;
create policy "interview_session_feedback_crud_own" on public.interview_session_feedback
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Resume documents
create table if not exists public.resume_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text,
  content_type text,
  size_bytes bigint,
  storage_bucket text,
  storage_path text,
  created_at timestamptz not null default now()
);

alter table public.resume_documents enable row level security;
create policy "resume_documents_crud_own" on public.resume_documents
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Resume generations (outputs)
create table if not exists public.resume_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.resume_documents(id) on delete set null,
  status text not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_resume_generations_updated_at on public.resume_generations;
create trigger set_resume_generations_updated_at
before update on public.resume_generations
for each row execute procedure public.set_updated_at();

alter table public.resume_generations enable row level security;
create policy "resume_generations_crud_own" on public.resume_generations
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Jobs (runs) - reuse existing public.jobs if present; ensure RLS exists
alter table if exists public.jobs enable row level security;

-- Indexes
create index if not exists interview_sessions_user_id_created_at_idx on public.interview_sessions(user_id, created_at desc);
create index if not exists interview_session_messages_session_id_created_at_idx on public.interview_session_messages(session_id, created_at asc);
create index if not exists resume_documents_user_id_created_at_idx on public.resume_documents(user_id, created_at desc);
create index if not exists resume_generations_user_id_created_at_idx on public.resume_generations(user_id, created_at desc);
