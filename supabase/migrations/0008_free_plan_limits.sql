-- Fix Free plan limits per PRD: Free = 10 min/month, Pro = 400 min/month
-- Update Free plan to have 10 copilot minutes monthly (matches PRD requirement)

update public.plans 
set 
  copilot_minutes_monthly = 10,
  copilot_session_minutes = 10,
  copilot_daily_minutes = 10
where id = 'free';

-- Verify the update
select id, name, copilot_minutes_monthly, copilot_session_minutes, copilot_daily_minutes 
from public.plans 
order by id;
