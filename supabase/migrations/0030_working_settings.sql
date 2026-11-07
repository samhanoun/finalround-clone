-- Settings and screens that used to save without doing anything now work.
-- Test: supabase/tests/0030_working_settings.sql

-- 1. Settings → Answer model ------------------------------------------------
-- A null model means "the server default". The coding model is separate
-- (coding, system design and Solve screen), and the answer length is a choice.
alter table public.llm_settings
  alter column provider drop not null,
  alter column provider drop default,
  alter column model drop not null,
  alter column model drop default,
  add column if not exists coding_model text,
  add column if not exists answer_length text;

alter table public.llm_settings
  drop constraint if exists llm_settings_answer_length_check,
  add constraint llm_settings_answer_length_check
    check (answer_length is null or answer_length in ('short', 'standard', 'detailed'));

-- 2. Notifications -----------------------------------------------------------
-- Only the server creates notifications (src/lib/notify.ts); users read them,
-- mark them read and delete them.
drop policy if exists notifications_crud_own on public.notifications;
drop policy if exists notifications_read_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_read_own on public.notifications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy notifications_update_own on public.notifications
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy notifications_delete_own on public.notifications
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, truncate on public.notifications from anon, authenticated;
grant update (read, read_at) on public.notifications to authenticated;
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

-- Browsers where the user turned on "Notify me on this device" (web push).
-- Written by /api/push/subscriptions with the service role.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_read_own on public.push_subscriptions;
create policy push_subscriptions_read_own on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete, truncate on public.push_subscriptions from anon, authenticated;
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Scheduled notices (reminders, the weekly digest) are sent once per key.
create table if not exists public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, dedupe_key)
);
alter table public.notification_log enable row level security;
revoke all on public.notification_log from anon, authenticated;

-- Jobs board: the interview date (interview reminders); follow-up dates already exist.
alter table public.job_applications add column if not exists interview_at timestamptz;
create index if not exists job_applications_interview_at_idx
  on public.job_applications (interview_at) where interview_at is not null;
create index if not exists job_applications_next_followup_at_idx
  on public.job_applications (next_followup_at) where next_followup_at is not null;
-- The "Job link" field on the Jobs board had nowhere to go.
alter table public.job_applications add column if not exists job_url text;

-- 3. Settings → Meeting apps (src/lib/meetingSettings.ts) ---------------------
-- Existing columns now drive the live copilot: preferred_platform,
-- auto_detect_platform (ask for the meeting link), screen_share_detection_enabled
-- (end the session when sharing stops) and audio_capture_enabled (use the
-- microphone). Two more choices:
alter table public.video_conferencing_settings
  add column if not exists uses_desktop_meeting_app boolean not null default false,
  add column if not exists auto_start_listening boolean not null default false;

-- 4. Team single sign-on (src/lib/sso.ts, /api/teams/[id]/sso) --------------
-- The sso_* columns decide which identity provider's users join which team,
-- so only the server changes them (a team owner could otherwise point their
-- team at another company's provider and collect its users).
create or replace function public.guard_organization_sso()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.sso_enabled := false;
    new.sso_provider := null;
    new.sso_config := '{}'::jsonb;
    return new;
  end if;
  if new.sso_enabled is distinct from old.sso_enabled
     or new.sso_provider is distinct from old.sso_provider
     or new.sso_config is distinct from old.sso_config then
    raise exception 'organizations single sign-on settings change through the app only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_organization_sso on public.organizations;
create trigger guard_organization_sso
before insert or update on public.organizations
for each row execute function public.guard_organization_sso();
revoke execute on function public.guard_organization_sso() from public, anon, authenticated;

-- One team per identity provider.
create unique index if not exists organizations_sso_provider_id_key
  on public.organizations ((sso_config ->> 'provider_id'))
  where sso_config ? 'provider_id';

-- 5. Analytics → Reports: scheduled email reports (src/lib/analyticsReports.ts) ----
-- Sent to the account's own email by /api/cron/notifications. Users read their
-- schedules; the API writes them (it sets next_send_at).
create table if not exists public.analytics_report_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  report_type text not null check (report_type in ('summary', 'job_search', 'practice', 'full')),
  frequency text not null check (frequency in ('weekly', 'monthly')),
  enabled boolean not null default true,
  last_sent_at timestamptz,
  next_send_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.analytics_report_schedules enable row level security;
drop policy if exists analytics_report_schedules_read_own on public.analytics_report_schedules;
create policy analytics_report_schedules_read_own on public.analytics_report_schedules
  for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete, truncate on public.analytics_report_schedules from anon, authenticated;
create index if not exists analytics_report_schedules_due_idx
  on public.analytics_report_schedules (next_send_at) where enabled;
create index if not exists analytics_report_schedules_user_idx on public.analytics_report_schedules (user_id);
