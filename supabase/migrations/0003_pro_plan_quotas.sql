-- Pro plan quotas: 400 copilot min/mo, 30 min/session, 45 min/day, smart mode 80 min/mo, resume deep reviews 10/mo
-- Apply with: supabase db push or psql

-- 1) plans - subscription tiers
create table if not exists public.plans (
  id text primary key,  -- 'free', 'pro', etc.
  name text not null,
  copilot_minutes_monthly int not null default 0,
  copilot_session_minutes int not null default 0,
  copilot_daily_minutes int not null default 0,
  smart_mode_minutes_monthly int not null default 0,
  resume_deep_reviews_monthly int not null default 0,
  created_at timestamptz not null default now()
);

-- 2) subscriptions - user plan assignments
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'active',  -- active, canceled, past_due
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute procedure public.set_updated_at();

-- 3) usage_counters - track usage within billing period
create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  counter_type text not null,  -- 'copilot_minutes', 'copilot_session_minutes', 'copilot_daily_minutes', 'smart_mode_minutes', 'resume_deep_reviews'
  period_start timestamptz not null,
  period_end timestamptz not null,
  used_amount int not null default 0,
  last_session_id uuid,  -- for session/daily tracking
  last_session_start timestamptz,  -- for session duration calculation
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, counter_type, period_start)
);

drop trigger if exists set_usage_counters_updated_at on public.usage_counters;
create trigger set_usage_counters_updated_at
before update on public.usage_counters
for each row execute procedure public.set_updated_at();

-- RLS policies
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_counters enable row level security;

-- Plans: readable by authenticated
create policy "plans_read_all" on public.plans
for select to authenticated
using (true);

-- Subscriptions: user sees own only
create policy "subscriptions_crud_own" on public.subscriptions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Usage counters: user sees own only
create policy "usage_counters_crud_own" on public.usage_counters
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Seed default plans
insert into public.plans (id, name, copilot_minutes_monthly, copilot_session_minutes, copilot_daily_minutes, smart_mode_minutes_monthly, resume_deep_reviews_monthly) values
  ('free', 'Free', 0, 0, 0, 0, 0),
  ('pro', 'Pro', 400, 30, 45, 80, 10)
on conflict (id) do nothing;

-- Indexes
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
create index if not exists usage_counters_user_type_period_idx on public.usage_counters(user_id, counter_type, period_start);

-- Helper function: get user's current plan (server-side only)
create or replace function public.get_user_plan(p_user_id uuid)
returns table (
  plan_id text,
  plan_name text,
  copilot_minutes_monthly int,
  copilot_session_minutes int,
  copilot_daily_minutes int,
  smart_mode_minutes_monthly int,
  resume_deep_reviews_monthly int
) security definer as $$
begin
  return query
  select 
    s.plan_id,
    p.name,
    p.copilot_minutes_monthly,
    p.copilot_session_minutes,
    p.copilot_daily_minutes,
    p.smart_mode_minutes_monthly,
    p.resume_deep_reviews_monthly
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.user_id = p_user_id
    and s.status = 'active'
    and (s.current_period_end is null or s.current_period_end > now())
  order by s.created_at desc
  limit 1;
end;
$$ language plpgsql;

-- Helper function: record usage (server-side only)
create or replace function public.record_usage(
  p_user_id uuid,
  p_counter_type text,
  p_amount int,
  p_session_id uuid default null,
  p_session_start timestamptz default null
)
returns void security definer as $$
declare
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_counter_id uuid;
begin
  -- Monthly counters: use start of current month
  if p_counter_type in ('copilot_minutes', 'smart_mode_minutes', 'resume_deep_reviews') then
    v_period_start := date_trunc('month', now());
    v_period_end := v_period_start + interval '1 month';
  else
    -- Daily/session: use start of current day
    v_period_start := date_trunc('day', now());
    v_period_end := v_period_start + interval '1 day';
  end if;

  -- Upsert usage counter
  insert into public.usage_counters (user_id, counter_type, period_start, period_end, used_amount, last_session_id, last_session_start)
    values (p_user_id, p_counter_type, v_period_start, v_period_end, p_amount, p_session_id, p_session_start)
  on conflict (user_id, counter_type, period_start)
  do update set
    used_amount = usage_counters.used_amount + p_amount,
    last_session_id = coalesce(p_session_id, usage_counters.last_session_id),
    last_session_start = coalesce(p_session_start, usage_counters.last_session_start);
end;
$$ language plpgsql;

-- Helper function: check quota (server-side only)
create or replace function public.check_quota(
  p_user_id uuid,
  p_counter_type text
)
returns table (
  allowed boolean,
  used int,
  limit_val int,
  remaining int
) security definer as $$
declare
  v_limit_val int;
  v_used int;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  -- Get limit from user's plan
  select 
    case p_counter_type
      when 'copilot_minutes' then p.copilot_minutes_monthly
      when 'copilot_session_minutes' then p.copilot_session_minutes
      when 'copilot_daily_minutes' then p.copilot_daily_minutes
      when 'smart_mode_minutes' then p.smart_mode_minutes_monthly
      when 'resume_deep_reviews' then p.resume_deep_reviews_monthly
      else 0
    end
  into v_limit_val
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.user_id = p_user_id
    and s.status = 'active'
    and (s.current_period_end is null or s.current_period_end > now())
  order by s.created_at desc
  limit 1;

  -- Default to free plan if no subscription
  if v_limit_val is null then
    select 
      case p_counter_type
        when 'copilot_minutes' then p.copilot_minutes_monthly
        when 'copilot_session_minutes' then p.copilot_session_minutes
        when 'copilot_daily_minutes' then p.copilot_daily_minutes
        when 'smart_mode_minutes' then p.smart_mode_minutes_monthly
        when 'resume_deep_reviews' then p.resume_deep_reviews_monthly
        else 0
      end
    into v_limit_val
    from public.plans p where p.id = 'free';
  end if;

  -- Get period bounds
  if p_counter_type in ('copilot_minutes', 'smart_mode_minutes', 'resume_deep_reviews') then
    v_period_start := date_trunc('month', now());
    v_period_end := v_period_start + interval '1 month';
  else
    v_period_start := date_trunc('day', now());
    v_period_end := v_period_start + interval '1 day';
  end if;

  -- Get current usage
  select coalesce(used_amount, 0) into v_used
  from public.usage_counters
  where user_id = p_user_id
    and counter_type = p_counter_type
    and period_start = v_period_start;

  return query select
    v_used + 1 <= v_limit_val,
    v_used,
    v_limit_val,
    greatest(0, v_limit_val - v_used);
end;
$$ language plpgsql;
