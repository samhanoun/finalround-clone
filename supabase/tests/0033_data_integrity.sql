-- Checks for 0033. Runs in a transaction that is rolled back.
begin;

do $$
declare
  rule "char";
  nullable text;
  checkdef text;
begin
  select c.confdeltype into rule
  from pg_constraint c
  where c.conname = 'organization_invitations_invited_by_fkey';
  if rule is distinct from 'n' then raise exception 'organization_invitations.invited_by is not ON DELETE SET NULL (%)', rule; end if;

  select c.confdeltype into rule from pg_constraint c where c.conname = 'organization_members_invited_by_fkey';
  if rule is distinct from 'n' then raise exception 'organization_members.invited_by is not ON DELETE SET NULL (%)', rule; end if;

  select c.confdeltype into rule from pg_constraint c where c.conname = 'audit_logs_user_id_fkey';
  if rule is distinct from 'n' then raise exception 'audit_logs.user_id is not ON DELETE SET NULL (%)', rule; end if;

  select is_nullable into nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'organization_invitations' and column_name = 'invited_by';
  if nullable <> 'YES' then raise exception 'organization_invitations.invited_by is still NOT NULL'; end if;

  select pg_get_constraintdef(c.oid) into checkdef from pg_constraint c where c.conname = 'social_shares_share_type_check';
  if checkdef not like '%referral%' then raise exception 'social_shares share_type check does not allow referral: %', checkdef; end if;

end;
$$;

select 'PASS 0033' as result;
rollback;
