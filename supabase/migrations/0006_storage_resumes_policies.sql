-- Storage policies for resumes bucket (private, owner-only)

-- 1) Ensure bucket exists and is private
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do update set public = false;

-- 2) RLS policies on storage.objects
-- Notes:
-- - We store resumes as: <user_id>/<timestamp>-<filename>
-- - We allow only the owner (auth.uid()) to read/write their own objects.

-- Drop old policies if re-running
DO $$
BEGIN
  -- These names are safe to drop if they exist
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='resumes_read_own') THEN
    EXECUTE 'DROP POLICY "resumes_read_own" ON storage.objects';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='resumes_insert_own') THEN
    EXECUTE 'DROP POLICY "resumes_insert_own" ON storage.objects';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='resumes_update_own') THEN
    EXECUTE 'DROP POLICY "resumes_update_own" ON storage.objects';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='resumes_delete_own') THEN
    EXECUTE 'DROP POLICY "resumes_delete_own" ON storage.objects';
  END IF;
END $$;

-- Read own
create policy "resumes_read_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Insert own
create policy "resumes_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update own (not used by app currently, but safe)
create policy "resumes_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete own
create policy "resumes_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
