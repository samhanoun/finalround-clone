-- Make app subscriptions upsert-friendly

-- Allow a single row per user per plan.
create unique index if not exists subscriptions_user_plan_unique
on public.subscriptions (user_id, plan_id);
