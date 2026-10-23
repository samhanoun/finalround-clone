-- Test for migration 0029. Runs as a signed-in user would through the API,
-- inside one transaction that is rolled back, so it leaves nothing behind.
-- Any failed check raises an exception:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0029_server_only_referrals_badges_team_plan.sql

begin;

-- Two throwaway users, a referral code, a team owned by the first, created as the owner role.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000291', 'referrer-0029@example.test'),
  ('00000000-0000-4000-8000-000000000292', 'referee-0029@example.test');
insert into public.referral_codes (user_id, code) values ('00000000-0000-4000-8000-000000000291', 'TEST0029');
insert into public.organizations (id, name, slug, plan)
  values ('00000000-0000-4000-8000-0000000002a1', 'Test team 0029', 'test-team-0029', 'free');
insert into public.organization_members (organization_id, user_id, role, status)
  values ('00000000-0000-4000-8000-0000000002a1', '00000000-0000-4000-8000-000000000291', 'owner', 'active');

-- 1. The service role records a referral; a second one for the same account is refused.
set local role service_role;
insert into public.referral_tracking (referrer_id, referee_id, referral_code, status)
  values ('00000000-0000-4000-8000-000000000291', '00000000-0000-4000-8000-000000000292', 'TEST0029', 'signed_up');
do $$
begin
  begin
    insert into public.referral_tracking (referrer_id, referee_id, referral_code, status)
      values ('00000000-0000-4000-8000-000000000291', '00000000-0000-4000-8000-000000000292', 'TEST0029', 'signed_up');
    raise exception 'FAIL: an account got two referrers';
  exception when unique_violation then null;
  end;
end;
$$;
reset role;

-- Act as the referrer (the team owner), the way PostgREST does for a signed-in request.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000291","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  me constant uuid := '00000000-0000-4000-8000-000000000291';
  team constant uuid := '00000000-0000-4000-8000-0000000002a1';
  n int;
begin
  -- 2. Users can still read their own referral data and badges.
  select count(*) into n from public.referral_tracking where referrer_id = me;
  if n <> 1 then raise exception 'FAIL: the referrer sees % of their 1 referral', n; end if;
  select count(*) into n from public.referral_codes where user_id = me;
  if n <> 1 then raise exception 'FAIL: the user cannot read their referral code'; end if;
  perform 1 from public.badges where user_id = me;

  -- 3. No writes to referrals or badges.
  begin
    insert into public.referral_tracking (referrer_id, referral_code, status) values (me, 'TEST0029', 'converted');
    raise exception 'FAIL: a user inserted a referral';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.referral_tracking set status = 'converted' where referrer_id = me;
    raise exception 'FAIL: a user marked a referral converted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.referral_codes set referral_count = 999, conversion_count = 999 where user_id = me;
    raise exception 'FAIL: a user edited their referral counters';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.referral_codes (user_id, code) values (me, 'SECOND29');
    raise exception 'FAIL: a user created a referral code';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.badges (user_id, badge_type, title) values (me, 'referral_conversion', 'Self-awarded');
    raise exception 'FAIL: a user awarded themselves a badge';
  exception when insufficient_privilege then null;
  end;

  -- 4. The owner can rename the team but not change its plan.
  update public.organizations set name = 'Renamed 0029' where id = team;
  if (select name from public.organizations where id = team) <> 'Renamed 0029' then
    raise exception 'FAIL: the owner could not rename the team';
  end if;
  begin
    update public.organizations set plan = 'enterprise' where id = team;
    raise exception 'FAIL: the owner upgraded the team plan';
  exception when insufficient_privilege then null;
  end;

  -- 5. The event-trigger function is not callable through the API.
  if has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute')
     or has_function_privilege('anon', 'public.rls_auto_enable()', 'execute') then
    raise exception 'FAIL: rls_auto_enable() is still executable by API roles';
  end if;
end;
$$;

-- 6. The service role can still change the plan (billing).
reset role;
set local role service_role;
update public.organizations set plan = 'team' where id = '00000000-0000-4000-8000-0000000002a1';
reset role;

-- 7. The ensure_rls event trigger still turns RLS on for new tables.
create table public.rls_check_0029 (id int);
do $$
begin
  if (select plan from public.organizations where id = '00000000-0000-4000-8000-0000000002a1') <> 'team' then
    raise exception 'FAIL: the service role could not change the plan';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.rls_check_0029'::regclass) then
    raise exception 'FAIL: RLS was not turned on for a new table';
  end if;
  raise notice 'PASS: 0029 server_only_referrals_badges_team_plan';
end;
$$;

rollback;
