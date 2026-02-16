-- Live interview copilot foundation
-- Adds: copilot_sessions, copilot_events, copilot_summaries (+ RLS + indexes)

create table if not exists public.copilot_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interview_session_id uuid references public.interview_sessions(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'stopped', 'expired')),
  title text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  duration_seconds int not null default 0,
  consumed_minutes int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.copilot_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.copilot_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('transcript', 'suggestion', 'system')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.copilot_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.copilot_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_type text not null default 'final',
  content text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, summary_type)
);

drop trigger if exists set_copilot_sessions_updated_at on public.copilot_sessions;
create trigger set_copilot_sessions_updated_at
before update on public.copilot_sessions
for each row execute procedure public.set_updated_at();

drop trigger if exists set_copilot_summaries_updated_at on public.copilot_summaries;
create trigger set_copilot_summaries_updated_at
before update on public.copilot_summaries
for each row execute procedure public.set_updated_at();

alter table public.copilot_sessions enable row level security;
alter table public.copilot_events enable row level security;
alter table public.copilot_summaries enable row level security;

create policy "copilot_sessions_crud_own" on public.copilot_sessions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "copilot_events_crud_own" on public.copilot_events
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "copilot_summaries_crud_own" on public.copilot_summaries
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create index if not exists copilot_sessions_user_id_created_at_idx
  on public.copilot_sessions(user_id, created_at desc);

create index if not exists copilot_sessions_user_id_status_started_at_idx
  on public.copilot_sessions(user_id, status, started_at desc);

create index if not exists copilot_events_session_id_created_at_idx
  on public.copilot_events(session_id, created_at asc);

create index if not exists copilot_events_user_id_created_at_idx
  on public.copilot_events(user_id, created_at desc);

create index if not exists copilot_summaries_session_id_created_at_idx
  on public.copilot_summaries(session_id, created_at desc);
