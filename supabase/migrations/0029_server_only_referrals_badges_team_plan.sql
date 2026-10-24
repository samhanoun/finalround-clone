-- Referrals, badges and a team's plan are written by the server only.
--
-- Until now (policies from 0016 and 0020), through the database API:
-- - anyone could insert referral_tracking rows, and a referrer could update
--   theirs (for example mark them converted);
-- - users could insert and update their own referral_codes, including the
--   referral_count and conversion_count counters;
-- - users could award themselves badges, or edit them;
-- - a team owner could change organizations.plan (e.g. to enterprise).
-- None of these unlocked paid features yet, but they are trust data.
--
-- From now on:
-- - referral_tracking, referral_codes and badges are read-only for users: the
--   app writes them with the service role (src/lib/referrals.ts,
--   /api/referrals, /api/social/shares); counts come from the tracking rows;
-- - each account can have only one referrer (unique referee_id);
-- - organizations.plan starts as "free" and only the service role changes it;
-- - rls_auto_enable(), the function behind the ensure_rls event trigger,
--   is no longer callable through the API (the trigger still fires).
--
-- Test: supabase/tests/0029_server_only_referrals_badges_team_plan.sql

-- Referral tracking
drop policy if exists "Anyone can insert referral tracking" on public.referral_tracking;
drop policy if exists "Users can update own referrals" on public.referral_tracking;
revoke insert, update, delete, truncate on public.referral_tracking from anon, authenticated;
create unique index if not exists referral_tracking_one_referrer_per_account
  on public.referral_tracking (referee_id)
  where referee_id is not null;

-- Referral codes
drop policy if exists "Users can insert own referral code" on public.referral_codes;
drop policy if exists "Users can update own referral code" on public.referral_codes;
revoke insert, update, delete, truncate on public.referral_codes from anon, authenticated;

-- Badges
drop policy if exists "Users can insert own badges" on public.badges;
drop policy if exists "Users can update own badges" on public.badges;
revoke insert, update, delete, truncate on public.badges from anon, authenticated;

-- A team's plan is billing data.
create or replace function public.guard_organization_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.plan := 'free';
    return new;
  end if;
  if new.plan is distinct from old.plan then
    raise exception 'organizations.plan changes through billing only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_organization_plan on public.organizations;
create trigger guard_organization_plan
before insert or update on public.organizations
for each row execute function public.guard_organization_plan();

-- An event-trigger function: nothing should call it through the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
