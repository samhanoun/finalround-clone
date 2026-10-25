-- Plan assignments and usage are billing data. Signed-in users may read their
-- own rows; only the service role (the Stripe webhook, the quota functions and
-- admin tooling) may change them.
--
-- Until now "subscriptions_crud_own" and "usage_counters_crud_own" allowed ALL
-- commands on a user's own rows, so anyone signed in could put themselves on
-- Pro (or Tester) without paying, or reset their usage.

drop policy if exists "subscriptions_crud_own" on public.subscriptions;
drop policy if exists "subscriptions_read_own" on public.subscriptions;
create policy "subscriptions_read_own" on public.subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "usage_counters_crud_own" on public.usage_counters;
drop policy if exists "usage_counters_read_own" on public.usage_counters;
create policy "usage_counters_read_own" on public.usage_counters
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No write privileges for API roles either, in case a permissive policy is added later.
revoke insert, update, delete, truncate on public.subscriptions from anon, authenticated;
revoke insert, update, delete, truncate on public.usage_counters from anon, authenticated;
revoke insert, update, delete, truncate on public.plans from anon, authenticated;
