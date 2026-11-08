-- Checks for 0032. Everything runs in a transaction that is rolled back, so
-- it leaves no data behind (run it through the Supabase SQL tool as is).
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000321', 'owner-0032@example.test'),
  ('00000000-0000-4000-8000-000000000322', 'other-0032@example.test');

do $$
declare
  owner_id uuid := '00000000-0000-4000-8000-000000000321';
  other_id uuid := '00000000-0000-4000-8000-000000000322';
  visible int;
  failed boolean;
begin
  -- The sign-up trigger (0024) creates each profile; make sure they exist.
  insert into public.profiles (id, email) values (owner_id, 'owner-0032@example.test') on conflict (id) do nothing;
  insert into public.profiles (id, email) values (other_id, 'other-0032@example.test') on conflict (id) do nothing;

  insert into public.availability_slots (user_id, day_of_week, start_time, end_time)
  values (other_id, 1, '09:00', '10:00');

  -- Signed in: another user's availability is invisible.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into visible from public.availability_slots where user_id = other_id;
  if visible <> 0 then raise exception 'FAIL availability_slots: another user''s slots are visible (%)', visible; end if;

  -- The public (anon) key sees nothing.
  reset role;
  set local role anon;
  select count(*) into visible from public.availability_slots;
  if visible <> 0 then raise exception 'FAIL availability_slots: anon can read % rows', visible; end if;

  -- A user can still edit their profile, but not its server-owned columns.
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set full_name = 'Renamed in test' where id = owner_id;
  get diagnostics visible = row_count;
  if visible <> 1 then raise exception 'FAIL profiles: the owner could not rename themself (% rows)', visible; end if;

  failed := false;
  begin
    update public.profiles set email = 'someone-else@example.com' where id = owner_id;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL profiles: a user changed their own email column'; end if;

  failed := false;
  begin
    update public.profiles set organization_id = gen_random_uuid() where id = owner_id;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL profiles: a user changed their own organization_id'; end if;

  -- A résumé row can't be pointed at another user's file; a normal one works,
  -- including a file name with two dots in it.
  failed := false;
  begin
    insert into public.resume_documents (user_id, filename, storage_bucket, storage_path)
    values (owner_id, 'stolen.pdf', 'resumes', other_id::text || '/cv.pdf');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL resume_documents: a row pointing at another user''s folder was inserted'; end if;

  insert into public.resume_documents (user_id, filename, storage_bucket, storage_path)
  values (owner_id, 'John..Doe.pdf', 'resumes', owner_id::text || '/1-John..Doe.pdf');

  failed := false;
  begin
    update public.resume_documents set storage_path = other_id::text || '/cv.pdf'
    where user_id = owner_id and filename = 'John..Doe.pdf';
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL resume_documents: a user re-pointed their row''s storage_path'; end if;

  update public.resume_documents set filename = 'Renamed.pdf' where user_id = owner_id and filename = 'John..Doe.pdf';
  get diagnostics visible = row_count;
  if visible <> 1 then raise exception 'FAIL resume_documents: a user could not rename their own file (% rows)', visible; end if;

  reset role;
end;
$$;

select 'PASS 0032' as result;
rollback;
