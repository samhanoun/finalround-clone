-- Scheduling Module
-- Tables for availability management and interview booking

-- Availability Slots
-- Defines when a user is available for interviews
create table if not exists public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6), -- 0=Sunday, 6=Saturday
  start_time time not null,
  end_time time not null,
  timezone text not null default 'UTC',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  constraint availability_slots_time_check check (end_time > start_time)
);

-- Trigger for updated_at
drop trigger if exists set_availability_slots_updated_at on public.availability_slots;
create trigger set_availability_slots_updated_at
before update on public.availability_slots
for each row execute procedure public.set_updated_at();

-- RLS
alter table public.availability_slots enable row level security;

create policy "availability_slots_crud_own" on public.availability_slots
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Allow public read for booking pages (if we want public booking pages)
create policy "availability_slots_read_public" on public.availability_slots
for select to anon, authenticated
using (true); 


-- Scheduled Interviews
-- Specific booked instances
create table if not exists public.scheduled_interviews (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  guest_email text not null,
  guest_name text,
  title text not null default 'Interview',
  description text,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'completed', 'no_show')),
  meeting_link text,
  google_calendar_event_id text,
  
  -- Notifications
  reminder_sent boolean not null default false,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  constraint scheduled_interviews_time_check check (end_time > start_time)
);

-- Trigger for updated_at
drop trigger if exists set_scheduled_interviews_updated_at on public.scheduled_interviews;
create trigger set_scheduled_interviews_updated_at
before update on public.scheduled_interviews
for each row execute procedure public.set_updated_at();

-- RLS
alter table public.scheduled_interviews enable row level security;

create policy "scheduled_interviews_crud_own" on public.scheduled_interviews
for all to authenticated
using (host_user_id = auth.uid())
with check (host_user_id = auth.uid());

-- Indexes
create index if not exists availability_slots_user_day_idx on public.availability_slots(user_id, day_of_week);
create index if not exists scheduled_interviews_host_start_idx on public.scheduled_interviews(host_user_id, start_time);
create index if not exists scheduled_interviews_guest_email_idx on public.scheduled_interviews(guest_email);
