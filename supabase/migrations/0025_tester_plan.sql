-- A plan for internal testing (build plan Step 8, real-call validation).
-- Pro caps a session at 30 minutes and a day at 45; the checklist needs a
-- 60-minute session plus several 15-minute calls on the same day.
-- Assign it by hand:
--   insert into public.subscriptions (user_id, plan_id, status)
--   values ('<auth user id>', 'tester', 'active');

insert into public.plans (
  id, name,
  copilot_minutes_monthly, copilot_session_minutes, copilot_daily_minutes,
  smart_mode_minutes_monthly, resume_deep_reviews_monthly
) values
  ('tester', 'Tester', 2000, 120, 180, 400, 50)
on conflict (id) do update set
  name = excluded.name,
  copilot_minutes_monthly = excluded.copilot_minutes_monthly,
  copilot_session_minutes = excluded.copilot_session_minutes,
  copilot_daily_minutes = excluded.copilot_daily_minutes,
  smart_mode_minutes_monthly = excluded.smart_mode_minutes_monthly,
  resume_deep_reviews_monthly = excluded.resume_deep_reviews_monthly;
