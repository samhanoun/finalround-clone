-- Final Round features: support tickets written by the server, goals,
-- materials and retrieval, long-term memory, playbooks and company question
-- banks. Test: supabase/tests/0031_copilot_features.sql

-- 1. Help & support -------------------------------------------------------------
-- Tickets and replies go through /api/support (src/lib/support.ts), so users
-- can't set a ticket's priority, status or assignee, or post as support.
-- Users keep reading their own tickets and messages.
drop policy if exists support_tickets_insert_own on public.support_tickets;
drop policy if exists support_tickets_update_own_or_admin on public.support_tickets;
drop policy if exists support_messages_insert_own_or_admin on public.support_messages;
revoke insert, update, delete, truncate on public.support_tickets from anon, authenticated;
revoke insert, update, delete, truncate on public.support_messages from anon, authenticated;

-- 2. Goals: one saved setup per job you're going for (src/lib/goals.ts) ---------
-- Company, role, round, résumé, job description, extra materials and a
-- playbook; the live copilot builds its context from the goal at session start.
create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  instructions text not null check (char_length(instructions) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  company text check (company is null or char_length(company) <= 200),
  role text check (role is null or char_length(role) <= 200),
  round text not null default 'other'
    check (round in ('screen', 'behavioral', 'technical', 'system_design', 'final', 'other')),
  resume_document_id uuid references public.resume_documents (id) on delete set null,
  job_description text check (job_description is null or char_length(job_description) <= 20000),
  job_application_id uuid references public.job_applications (id) on delete set null,
  playbook_id uuid references public.playbooks (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 4000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals (user_id, updated_at desc);

-- Materials: anything beyond the résumé and job description (project notes,
-- company research, a portfolio write-up), kept as text for retrieval.
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  kind text not null default 'notes' check (kind in ('notes', 'project', 'company', 'portfolio', 'other')),
  content text not null check (char_length(content) between 1 and 60000),
  source_filename text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists materials_user_idx on public.materials (user_id, created_at desc);

create table if not exists public.goal_materials (
  goal_id uuid not null references public.goals (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (goal_id, material_id)
);

-- 3. Long-term memory: facts about you, learned from your sessions or added by you.
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete set null,
  content text not null check (char_length(content) between 1 and 600),
  source text not null default 'manual' check (source in ('manual', 'session')),
  source_session_id uuid references public.copilot_sessions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists memories_user_idx on public.memories (user_id, created_at desc);

-- Everything above belongs to its user, who reads and edits it directly; a row
-- may only point at the user's own goal, material, résumé, job or playbook.
alter table public.playbooks enable row level security;
alter table public.goals enable row level security;
alter table public.materials enable row level security;
alter table public.goal_materials enable row level security;
alter table public.memories enable row level security;

drop policy if exists playbooks_own on public.playbooks;
create policy playbooks_own on public.playbooks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists materials_own on public.materials;
create policy materials_own on public.materials for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists goals_own on public.goals;
create policy goals_own on public.goals for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (resume_document_id is null or exists (
      select 1 from public.resume_documents d where d.id = resume_document_id and d.user_id = (select auth.uid())))
    and (job_application_id is null or exists (
      select 1 from public.job_applications j where j.id = job_application_id and j.user_id = (select auth.uid())))
    and (playbook_id is null or exists (
      select 1 from public.playbooks p where p.id = playbook_id and p.user_id = (select auth.uid())))
  );

drop policy if exists goal_materials_own on public.goal_materials;
create policy goal_materials_own on public.goal_materials for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = (select auth.uid()))
    and exists (select 1 from public.materials m where m.id = material_id and m.user_id = (select auth.uid()))
  );

drop policy if exists memories_own on public.memories;
create policy memories_own on public.memories for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and source = 'manual'
    and source_session_id is null
    and (goal_id is null or exists (select 1 from public.goals g where g.id = goal_id and g.user_id = (select auth.uid())))
  );

-- "Learn from my live sessions" (Goals → Memory).
alter table public.profiles add column if not exists memory_enabled boolean not null default true;

-- Company question banks: questions asked for a company, from your practice
-- interviews (kept automatically, private) and ones you report from real
-- interviews. A question you choose to share joins the bank other candidates
-- see, without anything that says who shared it.
create table if not exists public.company_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company text not null check (char_length(btrim(company)) between 1 and 120),
  company_key text generated always as (lower(btrim(company))) stored,
  role text check (role is null or char_length(role) <= 120),
  question_text text not null check (char_length(btrim(question_text)) between 8 and 500),
  question_key text generated always as (lower(btrim(question_text))) stored,
  question_type text not null default 'general'
    check (question_type in ('behavioral', 'technical', 'situational', 'general')),
  source text not null default 'reported' check (source in ('practice', 'reported')),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, company_key, question_key)
);
create index if not exists company_questions_company_idx on public.company_questions (company_key) where shared;
create index if not exists company_questions_user_idx on public.company_questions (user_id, company_key);

alter table public.company_questions enable row level security;

-- Only your own rows directly; the shared bank goes through the functions below.
drop policy if exists company_questions_own on public.company_questions;
create policy company_questions_own on public.company_questions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Shared questions for one company, one row per question however many
-- people shared it, newest first. Never returns who shared them.
create or replace function public.company_question_bank(p_company text, p_limit int default 100)
returns table (question_text text, question_type text, reports bigint, last_reported_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select min(q.question_text), min(q.question_type), count(distinct q.user_id), max(q.created_at)
  from public.company_questions q
  where q.shared and q.company_key = lower(btrim(p_company))
  group by q.question_key
  order by count(distinct q.user_id) desc, max(q.created_at) desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- Companies with shared questions, for finding a bank by name.
create or replace function public.company_question_companies(p_query text default null, p_limit int default 20)
returns table (company text, questions bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select min(q.company), count(distinct q.question_key)
  from public.company_questions q
  where q.shared
    and (p_query is null or q.company_key like '%' || replace(replace(replace(lower(btrim(p_query)), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  group by q.company_key
  order by count(distinct q.question_key) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.company_question_bank(text, int) from public, anon;
revoke execute on function public.company_question_companies(text, int) from public, anon;
grant execute on function public.company_question_bank(text, int) to authenticated;
grant execute on function public.company_question_companies(text, int) to authenticated;
