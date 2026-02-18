-- Notifications system for in-app notifications
-- Types: interview_reminder, application_update, ai_suggestion, system

-- Notifications table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('interview_reminder', 'application_update', 'ai_suggestion', 'system')),
  title text not null,
  message text not null,
  data jsonb default '{}'::jsonb,
  read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "notifications_crud_own" on public.notifications
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Notification preferences table (email settings)
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  email_interview_reminders boolean not null default true,
  email_application_updates boolean not null default true,
  email_ai_suggestions boolean not null default true,
  email_weekly_digest boolean not null default false,
  in_app_interview_reminders boolean not null default true,
  in_app_application_updates boolean not null default true,
  in_app_ai_suggestions boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
before update on public.notification_preferences
for each row execute procedure public.set_updated_at();

alter table public.notification_preferences enable row level security;

create policy "notification_preferences_crud_own" on public.notification_preferences
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Indexes
create index if not exists notifications_user_id_read_created_idx on public.notifications(user_id, read, created_at desc);
create index if not exists notifications_user_id_type_idx on public.notifications(user_id, type);
create index if not exists notification_preferences_user_id_idx on public.notification_preferences(user_id);
