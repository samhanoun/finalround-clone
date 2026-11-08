-- Data integrity fixes found by the wiring audit (2026-11-07).

-- 1. Deleting an account failed for anyone who had invited a teammate or
--    appeared in the audit log: these columns referenced auth.users with no
--    ON DELETE rule, so auth.admin.deleteUser refused. The rows stay (a team
--    keeps its members and history); only the pointer to the deleted person
--    becomes null.
do $$
declare
  target record;
  fk text;
begin
  for target in
    select * from (values
      ('organization_members', 'invited_by'),
      ('organization_invitations', 'invited_by'),
      ('audit_logs', 'user_id')
    ) as t(table_name, column_name)
  loop
    select c.conname into fk
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    join pg_attribute a on a.attrelid = r.oid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and n.nspname = 'public'
      and r.relname = target.table_name
      and a.attname = target.column_name
      and c.confrelid = 'auth.users'::regclass;
    if fk is not null then
      execute format('alter table public.%I drop constraint %I', target.table_name, fk);
    end if;
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      target.table_name, target.table_name || '_' || target.column_name || '_fkey', target.column_name
    );
  end loop;
end;
$$;

alter table public.organization_invitations alter column invited_by drop not null;

-- 2. Referral shares were rejected by the share_type check (the referral panel
--    records them as 'referral'), so none were ever counted.
do $$
declare
  ck text;
begin
  select c.conname into ck
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where c.contype = 'c' and n.nspname = 'public' and r.relname = 'social_shares'
    and pg_get_constraintdef(c.oid) like '%share_type%';
  if ck is not null then
    execute format('alter table public.social_shares drop constraint %I', ck);
  end if;
end;
$$;

alter table public.social_shares
  add constraint social_shares_share_type_check
  check (share_type in ('interview_report', 'badge', 'achievement', 'job_offer', 'referral'));
