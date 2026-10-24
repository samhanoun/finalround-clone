-- Quota helpers are SECURITY DEFINER and take an arbitrary user id, so they must
-- only be callable server-side (src/lib/quota.ts and /api/usage use the
-- service-role client). Also pin search_path on every function in this schema
-- that didn't set one.

revoke execute on function public.get_user_plan(uuid) from public, anon, authenticated;
revoke execute on function public.check_quota(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_usage(uuid, text, integer, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.get_user_plan(uuid) to service_role;
grant execute on function public.check_quota(uuid, text) to service_role;
grant execute on function public.record_usage(uuid, text, integer, uuid, timestamptz) to service_role;

alter function public.get_user_plan(uuid) set search_path = public;
alter function public.check_quota(uuid, text) set search_path = public;
alter function public.record_usage(uuid, text, integer, uuid, timestamptz) set search_path = public;
alter function public.set_updated_at() set search_path = '';
