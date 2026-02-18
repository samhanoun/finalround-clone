-- Admin dashboard tables: support tickets, fraud flags, usage analytics

-- 1) Support tickets
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  full_name text,
  subject text not null,
  description text not null,
  category text not null check (category in ('billing', 'technical', 'account', 'feature_request', 'other')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_user', 'resolved', 'closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  assigned_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Support ticket messages
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  is_from_admin boolean not null default false,
  content text not null,
  created_at timestamptz not null default now()
);

-- 3) Fraud detection flags
create table if not exists public.fraud_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flag_type text not null check (flag_type in ('suspicious_activity', 'chargeback', 'abuse', 'multiple_accounts', 'payment_failed', 'unusual_usage')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  description text not null,
  metadata jsonb default '{}'::jsonb,
  resolved boolean not null default false,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- 4) Daily usage analytics (aggregated)
create table if not exists public.daily_usage_stats (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  total_users int not null default 0,
  active_users int not null default 0,
  new_users int not null default 0,
  total_sessions int not null default 0,
  total_api_calls int not null default 0,
  total_stripe_revenue_cents int not null default 0,
  total_subscriptions int not null default 0,
  active_subscriptions int not null default 0,
  churned_subscriptions int not null default 0,
  fraud_flags_raised int not null default 0,
  support_tickets_opened int not null default 0,
  support_tickets_resolved int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5) Admin users (superset of regular users)
create table if not exists public.admin_users (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'super_admin', 'support_agent')),
  permissions jsonb default '["read"]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id)
);

-- Indexes
create index if not exists support_tickets_user_id_idx on public.support_tickets(user_id);
create index if not exists support_tickets_status_idx on public.support_tickets(status);
create index if not exists support_tickets_priority_idx on public.support_tickets(priority);
create index if not exists support_tickets_created_at_idx on public.support_tickets(created_at desc);
create index if not exists support_messages_ticket_id_idx on public.support_messages(ticket_id);
create index if not exists fraud_flags_user_id_idx on public.fraud_flags(user_id);
create index if not exists fraud_flags_resolved_idx on public.fraud_flags(resolved);
create index if not exists fraud_flags_created_at_idx on public.fraud_flags(created_at desc);
create index if not exists daily_usage_stats_date_idx on public.daily_usage_stats(date desc);

-- RLS
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.fraud_flags enable row level security;
alter table public.daily_usage_stats enable row level security;
alter table public.admin_users enable row level security;

-- Support tickets policies
create policy "support_tickets_select_authenticated" on public.support_tickets
for select to authenticated
using (true);

create policy "support_tickets_insert_authenticated" on public.support_tickets
for insert to authenticated
with check (true);

create policy "support_tickets_update_authenticated" on public.support_tickets
for update to authenticated
using (true);

-- Support messages policies
create policy "support_messages_select_authenticated" on public.support_messages
for select to authenticated
using (true);

create policy "support_messages_insert_authenticated" on public.support_messages
for insert to authenticated
with check (true);

-- Fraud flags policies (admin only)
create policy "fraud_flags_select_admin" on public.fraud_flags
for select to authenticated
using (
  exists (select 1 from public.admin_users where user_id = auth.uid())
);

create policy "fraud_flags_update_admin" on public.fraud_flags
for update to authenticated
using (
  exists (select 1 from public.admin_users where user_id = auth.uid())
);

create policy "fraud_flags_insert_admin" on public.fraud_flags
for insert to authenticated
with check (
  exists (select 1 from public.admin_users where user_id = auth.uid())
);

-- Daily usage stats (admin only)
create policy "daily_usage_stats_select_admin" on public.daily_usage_stats
for select to authenticated
using (
  exists (select 1 from public.admin_users where user_id = auth.uid())
);

-- Admin users (self + admin)
create policy "admin_users_select" on public.admin_users
for select to authenticated
using (
  exists (select 1 from public.admin_users where user_id = auth.uid())
);

create policy "admin_users_insert" on public.admin_users
for insert to authenticated
with check (
  exists (select 1 from public.admin_users where user_id = auth.uid() and role = 'super_admin')
);

-- Updated_at triggers
drop trigger if exists set_support_tickets_updated_at on public.support_tickets;
create trigger set_support_tickets_updated_at
before update on public.support_tickets
for each row execute procedure public.set_updated_at();

drop trigger if exists set_daily_usage_stats_updated_at on public.daily_usage_stats;
create trigger set_daily_usage_stats_updated_at
before update on public.daily_usage_stats
for each row execute procedure public.set_updated_at();

-- Grant access to service_role
grant all on public.support_tickets to service_role;
grant all on public.support_messages to service_role;
grant all on public.fraud_flags to service_role;
grant all on public.daily_usage_stats to service_role;
grant all on public.admin_users to service_role;
