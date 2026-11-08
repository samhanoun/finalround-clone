-- Checks for 0034. Everything runs in a transaction that is rolled back, so
-- it leaves no data behind (run it through the Supabase SQL tool as is).
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000341', 'owner-0034@example.test'),
  ('00000000-0000-4000-8000-000000000342', 'admin-0034@example.test');

do $$
declare
  owner_id uuid := '00000000-0000-4000-8000-000000000341';
  admin_id uuid := '00000000-0000-4000-8000-000000000342';
  org uuid := gen_random_uuid();
  changed int;
  failed boolean;
begin
  -- The sign-up trigger (0024) creates each profile; make sure they exist.
  insert into public.profiles (id, email) values (owner_id, 'owner-0034@example.test') on conflict (id) do nothing;
  insert into public.profiles (id, email) values (admin_id, 'admin-0034@example.test') on conflict (id) do nothing;

  insert into public.organizations (id, name, slug) values (org, 'Test 0034', 'test-0034-' || substr(org::text, 1, 8));
  insert into public.organization_members (organization_id, user_id, role, status) values
    (org, owner_id, 'owner', 'active'),
    (org, admin_id, 'admin', 'active');
  insert into public.organization_invitations (organization_id, email, role, invited_by) values
    (org, 'invited-admin-0034@example.test', 'admin', owner_id),
    (org, 'invited-member-0034@example.test', 'member', owner_id);

  -- As the admin: members and viewers are theirs to invite and manage.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.organization_invitations (organization_id, email, role, invited_by)
  values (org, 'new-viewer-0034@example.test', 'viewer', admin_id);

  update public.organization_invitations set role = 'viewer'
  where organization_id = org and email = 'invited-member-0034@example.test';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL invitations: the admin could not change a member''s invitation (% rows)', changed; end if;

  -- ...but not an admin invitation: neither a new one,
  failed := false;
  begin
    insert into public.organization_invitations (organization_id, email, role, invited_by)
    values (org, 'new-admin-0034@example.test', 'admin', admin_id);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL invitations: an admin invited an admin'; end if;

  -- nor one made from another invitation,
  failed := false;
  begin
    update public.organization_invitations set role = 'admin'
    where organization_id = org and email = 'invited-member-0034@example.test';
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL invitations: an admin turned an invitation into an admin one'; end if;

  -- and the owner's admin invitation can't be changed, cancelled or deleted (no row matches).
  update public.organization_invitations set role = 'member'
  where organization_id = org and email = 'invited-admin-0034@example.test';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL invitations: an admin changed an admin invitation'; end if;

  update public.organization_invitations set status = 'cancelled'
  where organization_id = org and email = 'invited-admin-0034@example.test';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL invitations: an admin cancelled an admin invitation'; end if;

  delete from public.organization_invitations where organization_id = org and email = 'invited-admin-0034@example.test';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL invitations: an admin deleted an admin invitation'; end if;

  -- The admin still sees it in the list.
  select count(*) into changed from public.organization_invitations where organization_id = org and role = 'admin';
  if changed <> 1 then raise exception 'FAIL invitations: the admin can''t see the team''s admin invitation (% rows)', changed; end if;

  -- As the owner: admin invitations are theirs.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.organization_invitations (organization_id, email, role, invited_by)
  values (org, 'second-admin-0034@example.test', 'admin', owner_id);

  update public.organization_invitations set status = 'cancelled'
  where organization_id = org and email = 'invited-admin-0034@example.test';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'FAIL invitations: the owner could not cancel an admin invitation (% rows)', changed; end if;

  reset role;
end;
$$;

select 'PASS 0034' as result;
rollback;
