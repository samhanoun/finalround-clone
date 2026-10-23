-- Ending a live session is what charges its minutes, so users must not be able
-- to create, end or rewrite sessions themselves. Until now
-- "copilot_sessions_crud_own" (0007) let a signed-in user do anything to their
-- own rows through the API: set status to stopped (skipping the charge the
-- stop route makes), insert sessions without the start route's quota check, or
-- forge the heartbeat that expiry billing relies on.
--
-- From now on:
-- - users may read their own sessions, and delete ones that have ended
--   (history clean-up);
-- - starting, heartbeats, stopping and expiry go through the app's routes,
--   which write with the service role and charge every session that ends
--   (src/lib/copilot/endSession.ts);
-- - an active session can't be deleted by a user, since it would never be
--   charged.
-- The 0027 trigger stays as a second line of defence.
--
-- Test: supabase/tests/0028_server_only_copilot_session_writes.sql

drop policy if exists "copilot_sessions_crud_own" on public.copilot_sessions;
drop policy if exists "copilot_sessions_read_own" on public.copilot_sessions;
drop policy if exists "copilot_sessions_delete_ended_own" on public.copilot_sessions;

create policy "copilot_sessions_read_own" on public.copilot_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "copilot_sessions_delete_ended_own" on public.copilot_sessions
  for delete to authenticated
  using (user_id = (select auth.uid()) and status <> 'active');

-- No write privileges for API roles either, in case a permissive policy is added later.
revoke insert, update, truncate on public.copilot_sessions from anon, authenticated;
