-- Every auth user needs a profiles row: onboarding only UPDATEs profiles and the
-- dashboard redirects to /onboarding until profiles.onboarding_completed is true,
-- so without a row a signed-in user loops forever. profiles has no INSERT policy,
-- so create the row server-side when the auth user is created.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Backfill users created before this trigger existed.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;
