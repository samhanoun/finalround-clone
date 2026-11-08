-- Test for migration 0030. Runs as a signed-in user would through the API,
-- inside one transaction that is rolled back, so it leaves nothing behind.
-- Any failed check raises an exception:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0030_working_settings.sql

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000301', 'owner-0030@example.test'),
  ('00000000-0000-4000-8000-000000000302', 'other-0030@example.test');
insert into public.organizations (id, name, slug, plan)
  values ('00000000-0000-4000-8000-0000000003a1', 'Test team 0030', 'test-team-0030', 'free');
insert into public.organization_members (organization_id, user_id, role, status)
  values ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-000000000301', 'owner', 'active');

-- Rows only the server (service role) creates.
set local role service_role;
insert into public.notifications (id, user_id, type, title, message)
  values ('00000000-0000-4000-8000-0000000003b1', '00000000-0000-4000-8000-000000000301', 'system', 'Hello', 'From the server');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('00000000-0000-4000-8000-000000000301', 'https://push.example.test/0030', 'p', 'a');
insert into public.analytics_report_schedules (user_id, report_type, frequency, next_send_at)
  values ('00000000-0000-4000-8000-000000000301', 'summary', 'weekly', now() + interval '1 day');
insert into public.notification_log (user_id, dedupe_key) values ('00000000-0000-4000-8000-000000000301', 'test:0030');
-- The server can turn single sign-on on.
update public.organizations
  set sso_enabled = true, sso_provider = 'saml', sso_config = '{"provider_id":"prov-0030","domains":["example.test"]}'
  where id = '00000000-0000-4000-8000-0000000003a1';
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  me constant uuid := '00000000-0000-4000-8000-000000000301';
  team constant uuid := '00000000-0000-4000-8000-0000000003a1';
  n int;
begin
  -- 1. Settings → Answer model: a null model, a coding model and an answer length.
  insert into public.llm_settings (user_id, provider, model, coding_model, temperature, answer_length)
    values (me, null, null, 'gpt-4o', 0.2, 'short');
  begin
    update public.llm_settings set answer_length = 'endless' where user_id = me;
    raise exception 'FAIL: an unknown answer length was accepted';
  exception when check_violation then null;
  end;

  -- 2. Notifications: read, mark read, delete; never create or rewrite.
  select count(*) into n from public.notifications where user_id = me;
  if n <> 1 then raise exception 'FAIL: the user sees % of their 1 notification', n; end if;
  update public.notifications set read = true, read_at = now() where user_id = me;
  begin
    update public.notifications set title = 'Forged' where user_id = me;
    raise exception 'FAIL: a user rewrote a notification';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notifications (user_id, type, title, message) values (me, 'system', 'Forged', 'x');
    raise exception 'FAIL: a user created a notification';
  exception when insufficient_privilege then null;
  end;

  -- 3. Push devices and report schedules: readable, written by the server only.
  select count(*) into n from public.push_subscriptions where user_id = me;
  if n <> 1 then raise exception 'FAIL: the user cannot read their device'; end if;
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (me, 'https://push.example.test/forged', 'p', 'a');
    raise exception 'FAIL: a user registered a device directly';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.analytics_report_schedules where user_id = me;
  if n <> 1 then raise exception 'FAIL: the user cannot read their report schedule'; end if;
  begin
    update public.analytics_report_schedules set next_send_at = now() where user_id = me;
    raise exception 'FAIL: a user moved their report schedule';
  exception when insufficient_privilege then null;
  end;

  -- 4. The notification log is server-only.
  begin
    perform 1 from public.notification_log;
    raise exception 'FAIL: a user read the notification log';
  exception when insufficient_privilege then null;
  end;

  -- 5. Jobs board dates and link; meeting settings.
  insert into public.job_applications (user_id, company, title, stage, status, interview_at, next_followup_at, job_url)
    values (me, 'Acme', 'Engineer', 'interview', 'active', now() + interval '1 day', now() + interval '2 days', 'https://acme.example.test/job');
  insert into public.video_conferencing_settings (user_id, preferred_platform, uses_desktop_meeting_app, auto_start_listening)
    values (me, 'zoom', true, true);

  -- 6. Single sign-on settings can't be changed by the owner.
  update public.organizations set name = 'Renamed 0030' where id = team;
  begin
    update public.organizations set sso_config = '{"provider_id":"someone-elses"}' where id = team;
    raise exception 'FAIL: the owner repointed single sign-on';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.organizations set sso_enabled = false where id = team;
    raise exception 'FAIL: the owner changed sso_enabled directly';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 7. One team per identity provider.
reset role;
insert into public.organizations (id, name, slug, plan)
  values ('00000000-0000-4000-8000-0000000003a2', 'Other team 0030', 'other-team-0030', 'free');
do $$
begin
  begin
    update public.organizations set sso_config = '{"provider_id":"prov-0030"}' where id = '00000000-0000-4000-8000-0000000003a2';
    raise exception 'FAIL: two teams share one identity provider';
  exception when unique_violation then null;
  end;
  raise notice 'PASS: 0030 working_settings';
end;
$$;

rollback;
