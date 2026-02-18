-- Multi-question interview flow with adaptive difficulty
-- Adds: interview_questions table

create table if not exists public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_text text not null,
  question_type text not null default 'behavioral' check (question_type in ('behavioral', 'technical', 'situational', 'general')),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  order_index int not null default 0,
  response_text text,
  response_score int,
  rubric jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

alter table public.interview_questions enable row level security;

create policy "interview_questions_crud_own" on public.interview_questions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index if not exists interview_questions_session_id_order_idx
  on public.interview_questions(session_id, order_index);

create index if not EXISTS interview_questions_session_id_difficulty_idx
  on public.interview_questions(session_id, difficulty);

-- Interview reports table
create table if not exists public.interview_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'general',
  overall_score int,
  hiring_signal text,
  summary text,
  strengths jsonb default '[]'::jsonb,
  weaknesses jsonb default '[]'::jsonb,
  next_steps jsonb default '[]'::jsonb,
  rubric jsonb default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.interview_reports enable row level security;

create policy "interview_reports_crud_own" on public.interview_reports
for all to authenticated
using (user_id =auth.uid())
with check (user_id = auth.uid());

create index if not exists interview_reports_session_id_idx
  on public.interview_reports(session_id);
