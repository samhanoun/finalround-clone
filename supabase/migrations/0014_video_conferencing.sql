-- Video Conferencing Integration Settings
-- Stores user preferences for Zoom, Google Meet, Microsoft Teams integrations

create table if not exists public.video_conferencing_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  
  -- Zoom Integration
  zoom_enabled boolean not null default false,
  zoom_auto_capture boolean not null default false,
  zoom_screen_share_detection boolean not null default true,
  
  -- Google Meet Integration
  google_meet_enabled boolean not null default false,
  google_meet_auto_capture boolean not null default false,
  google_meet_screen_share_detection boolean not null default true,
  
  -- Microsoft Teams Integration
  ms_teams_enabled boolean not null default false,
  ms_teams_auto_capture boolean not null default false,
  ms_teams_screen_share_detection boolean not null default true,
  
  -- Audio capture settings
  audio_capture_enabled boolean not null default true,
  audio_input_device_id text,
  audio_sample_rate int not null default 16000,
  audio_channels int not null default 1,
  
  -- Screen share detection settings
  screen_share_detection_enabled boolean not null default true,
  screen_share_callback_url text,
  
  -- General settings
  preferred_platform text check (preferred_platform in ('zoom', 'google_meet', 'ms_teams', 'auto')) default 'auto',
  auto_detect_platform boolean not null default true,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- Table for storing detected video conferencing sessions
create table if not exists public.video_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  
  -- Platform identification
  platform text not null check (platform in ('zoom', 'google_meet', 'ms_teams', 'unknown')),
  platform_session_id text,
  
  -- Detection metadata
  detected_at timestamptz not null default now(),
  session_title text,
  participant_count int,
  
  -- Screen share state
  screen_share_active boolean not null default false,
  screen_share_started_at timestamptz,
  screen_share_ended_at timestamptz,
  screen_share_duration_seconds int,
  
  -- Audio capture state
  audio_capture_active boolean not null default false,
  audio_capture_started_at timestamptz,
  audio_capture_ended_at timestamptz,
  audio_capture_duration_seconds int,
  
  -- Status
  status text not null default 'active' check (status in ('active', 'ended', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- Table for audio capture events
create table if not exists public.video_audio_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.video_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  
  -- Audio metadata
  event_type text not null check (event_type in ('start', 'stop', 'data', 'error')),
  audio_data bytea,
  transcript_text text,
  duration_ms int,
  
  -- Technical metadata
  device_id text,
  sample_rate int,
  channels int,
  format text,
  
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Table for screen share events
create table if not exists public.video_screen_share_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.video_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  
  -- Event data
  event_type text not null check (event_type in ('started', 'stopped', 'pause', 'resume')),
  
  -- Screen metadata
  screen_width int,
  screen_height int,
  source_id text,
  source_name text,
  
  -- Timing
  duration_seconds int,
  
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Triggers for updated_at
drop trigger if exists set_video_conferencing_settings_updated_at on public.video_conferencing_settings;
create trigger set_video_conferencing_settings_updated_at
before update on public.video_conferencing_settings
for each row execute procedure public.set_updated_at();

-- RLS Policies
alter table public.video_conferencing_settings enable row level security;
alter table public.video_sessions enable row level security;
alter table public.video_audio_events enable row level security;
alter table public.video_screen_share_events enable row level security;

-- Video conferencing settings policies
create policy "video_conferencing_settings_crud_own" on public.video_conferencing_settings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Video sessions policies
create policy "video_sessions_crud_own" on public.video_sessions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "video_sessions_read_own" on public.video_sessions
for read to authenticated
using (user_id = auth.uid());

-- Audio events policies
create policy "video_audio_events_crud_own" on public.video_audio_events
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "video_audio_events_read_own" on public.video_audio_events
for read to authenticated
using (user_id = auth.uid());

-- Screen share events policies
create policy "video_screen_share_events_crud_own" on public.video_screen_share_events
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "video_screen_share_events_read_own" on public.video_screen_share_events
for read to authenticated
using (user_id = auth.uid());

-- Indexes
create index if not exists video_conferencing_settings_user_id_idx
  on public.video_conferencing_settings(user_id);

create index if not exists video_sessions_user_id_created_at_idx
  on public.video_sessions(user_id, created_at desc);

create index if not exists video_sessions_platform_status_idx
  on public.video_sessions(platform, status);

create index if not exists video_audio_events_session_id_created_at_idx
  on public.video_audio_events(session_id, created_at asc);

create index if not exists video_screen_share_events_session_id_created_at_idx
  on public.video_screen_share_events(session_id, created_at asc);
