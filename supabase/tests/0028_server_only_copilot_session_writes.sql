-- Test for migration 0028 (copilot sessions are written by the server only).
-- Runs inside one transaction that is rolled back, so it leaves nothing
-- behind. Any failed check raises an exception:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0028_server_only_copilot_session_writes.sql

begin;

-- A throwaway user with one live and one ended session, created as the owner.
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000028', 'session-writes-test@example.test');
insert into public.copilot_sessions (id, user_id, status)
values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000028', 'active'),
       ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000028', 'stopped');

-- Act as that user, the way PostgREST does for a signed-in request.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000028","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  uid constant uuid := '00000000-0000-4000-8000-000000000028';
  live_id constant uuid := '00000000-0000-4000-8000-0000000000b1';
  ended_id constant uuid := '00000000-0000-4000-8000-0000000000b2';
  n int;
begin
  -- 1. The user can read their own sessions.
  select count(*) into n from public.copilot_sessions where user_id = uid;
  if n <> 2 then raise exception 'FAIL: the user sees % of their 2 sessions', n; end if;

  -- 2. They can't start a session without the start route (and its quota check).
  begin
    insert into public.copilot_sessions (user_id, status) values (uid, 'active');
    raise exception 'FAIL: a signed-in user inserted a session';
  exception when insufficient_privilege then null;
  end;

  -- 3. They can't end it themselves, which would skip the charge.
  begin
    update public.copilot_sessions set status = 'stopped' where id = live_id;
    raise exception 'FAIL: a signed-in user stopped a session directly';
  exception when insufficient_privilege then null;
  end;

  -- 4. Nor forge the heartbeat that expiry billing uses.
  begin
    update public.copilot_sessions set metadata = '{"last_heartbeat_at":"2000-01-01T00:00:00Z"}'::jsonb where id = live_id;
    raise exception 'FAIL: a signed-in user rewrote the heartbeat';
  exception when insufficient_privilege then null;
  end;

  -- 5. Deleting the live session does nothing (it must be ended and charged first).
  delete from public.copilot_sessions where id = live_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a signed-in user deleted an active session'; end if;

  -- 6. An ended session can still be deleted from history.
  delete from public.copilot_sessions where id = ended_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: a signed-in user could not delete an ended session'; end if;
end;
$$;

-- 7. The app's service role can still end and charge sessions.
reset role;
set local role service_role;
update public.copilot_sessions
set status = 'stopped', stopped_at = now(), duration_seconds = 60, consumed_minutes = 1
where id = '00000000-0000-4000-8000-0000000000b1';

do $$
begin
  if (select status from public.copilot_sessions where id = '00000000-0000-4000-8000-0000000000b1') <> 'stopped' then
    raise exception 'FAIL: the service role could not stop the session';
  end if;
  raise notice 'PASS: 0028 server_only_copilot_session_writes';
end;
$$;

rollback;
