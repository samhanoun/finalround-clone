-- Test for migration 0027 (guard_copilot_session_timing). Runs as a signed-in
-- user would through the API, inside one transaction that is rolled back, so
-- it leaves nothing behind. Any failed check raises an exception:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0027_guard_copilot_session_timing.sql

begin;

-- A throwaway user (the transaction is rolled back at the end).
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000027', 'session-guard-test@example.test');

-- Act as that user, the way PostgREST does for a signed-in request.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000027","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  uid constant uuid := '00000000-0000-4000-8000-000000000027';
  stopped_id constant uuid := '00000000-0000-4000-8000-0000000000a1';
  expired_id constant uuid := '00000000-0000-4000-8000-0000000000a2';
  started timestamptz;
begin
  -- 1. A new session starts now, whatever started_at the client sends.
  insert into public.copilot_sessions (id, user_id, status, started_at)
  values (stopped_id, uid, 'active', now() - interval '2 hours')
  returning started_at into started;
  if started <> now() then
    raise exception 'FAIL: insert kept the client''s started_at (%)', started;
  end if;

  -- 2. started_at can't be moved afterwards.
  begin
    update public.copilot_sessions set started_at = now() + interval '1 hour' where id = stopped_id;
    raise exception 'FAIL: started_at was changed';
  exception when insufficient_privilege then null;
  end;

  -- 3. Nor can the owner.
  begin
    update public.copilot_sessions set user_id = gen_random_uuid() where id = stopped_id;
    raise exception 'FAIL: user_id was changed';
  exception when insufficient_privilege then null;
  end;

  -- 4. The app's own writes still work: heartbeat metadata, then stop.
  update public.copilot_sessions set metadata = '{"heartbeat_at":"test"}'::jsonb where id = stopped_id;
  update public.copilot_sessions
  set status = 'stopped', stopped_at = now(), duration_seconds = 60, consumed_minutes = 1
  where id = stopped_id;
  if (select status from public.copilot_sessions where id = stopped_id) <> 'stopped' then
    raise exception 'FAIL: the stop update did not apply';
  end if;

  -- 5. A stopped session stays stopped.
  begin
    update public.copilot_sessions set status = 'active' where id = stopped_id;
    raise exception 'FAIL: a stopped session was made active again';
  exception when insufficient_privilege then null;
  end;

  -- 6. Same for an expired one (heartbeat timeout).
  insert into public.copilot_sessions (id, user_id, status) values (expired_id, uid, 'active');
  update public.copilot_sessions set status = 'expired', stopped_at = now() where id = expired_id;
  begin
    update public.copilot_sessions set status = 'active' where id = expired_id;
    raise exception 'FAIL: an expired session was made active again';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- 7. The database owner (and the service role) are not restricted.
reset role;
update public.copilot_sessions
set started_at = now() - interval '5 minutes'
where id = '00000000-0000-4000-8000-0000000000a1';

do $$
begin
  if (select started_at from public.copilot_sessions where id = '00000000-0000-4000-8000-0000000000a1')
     <> now() - interval '5 minutes' then
    raise exception 'FAIL: the owner could not correct started_at';
  end if;
  raise notice 'PASS: 0027 guard_copilot_session_timing';
end;
$$;

rollback;
