-- A live session's timing is billing data: the answer, Solve screen and stop
-- routes work out the minutes used from started_at, and the stop route charges
-- them. Until now "copilot_sessions_crud_own" (0007) let a signed-in user update
-- any column of their own sessions, so they could keep moving started_at
-- forward for unlimited minutes, or switch an ended session back to active.
--
-- For the API roles (anon, authenticated):
-- - a new session starts now, whatever started_at the request carries;
-- - started_at and user_id never change after that;
-- - an ended session (stopped or expired) stays ended.
-- The service role and the database owner are not restricted.
--
-- Test: supabase/tests/0027_guard_copilot_session_timing.sql

create or replace function public.guard_copilot_session_timing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.started_at := now();
    return new;
  end if;

  if new.started_at is distinct from old.started_at then
    raise exception 'copilot_sessions.started_at cannot be changed' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'copilot_sessions.user_id cannot be changed' using errcode = '42501';
  end if;
  if old.status <> 'active' and new.status = 'active' then
    raise exception 'an ended copilot session cannot be made active again' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_copilot_session_timing on public.copilot_sessions;
create trigger guard_copilot_session_timing
before insert or update on public.copilot_sessions
for each row execute function public.guard_copilot_session_timing();
