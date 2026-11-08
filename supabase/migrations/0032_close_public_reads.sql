-- Three read/write gaps found by the security review (2026-11-07).
--
-- 1. availability_slots had a policy letting anon and authenticated read every
--    row (`using (true)`). The anon key ships to browsers, so anyone could list
--    every user's weekly availability and time zone through the REST API. No
--    feature reads other users' slots; the app's own route scopes by user id.
--    Owners keep full access through availability_slots_crud_own.
drop policy if exists "availability_slots_read_public" on public.availability_slots;

-- 2. profiles_update_own lets a user update any column of their own row,
--    including email and organization_id. Nothing trusts those columns for
--    authorization today, but they are written by the server (sign-up trigger,
--    team membership), so users may not change them directly.
create or replace function public.guard_profile_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.id is distinct from old.id
    or new.email is distinct from old.email
    or new.organization_id is distinct from old.organization_id
    or new.created_at is distinct from old.created_at then
    raise exception 'profiles: id, email, organization_id and created_at change through the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_server_columns on public.profiles;
create trigger guard_profile_server_columns
before update on public.profiles
for each row execute function public.guard_profile_server_columns();

revoke execute on function public.guard_profile_server_columns() from public, anon, authenticated;

-- 3. resume_documents: users may insert and update their own rows
--    (resume_documents_crud_own), and the server later reads or deletes the
--    file at storage_bucket/storage_path with the service role. So a row could
--    be pointed at another user's file. The location is set by the upload
--    route: users can't change it, and a row they insert must point into their
--    own folder of the private resumes bucket.
create or replace function public.guard_resume_document_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
    or new.user_id is distinct from old.user_id
  ) then
    raise exception 'resume_documents: the file location changes through the server only' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (new.storage_bucket is not null or new.storage_path is not null) then
    if new.storage_bucket is distinct from 'resumes'
      or new.storage_path is null
      or split_part(new.storage_path, '/', 1) <> auth.uid()::text
      or new.storage_path ~ '(^|/)\.\.(/|$)' then
      raise exception 'resume_documents: a file must be in your own folder of the resumes bucket' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_resume_document_location on public.resume_documents;
create trigger guard_resume_document_location
before insert or update on public.resume_documents
for each row execute function public.guard_resume_document_location();

revoke execute on function public.guard_resume_document_location() from public, anon, authenticated;
