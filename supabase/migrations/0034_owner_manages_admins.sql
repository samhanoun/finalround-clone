-- Only a team's owner manages admins (security review, 2026-11-08).
--
-- Admins manage members and viewers. The API now refuses to let an admin
-- remove, demote or appoint an admin, or create, renew or cancel an invitation
-- as admin (src/lib/teamRoles.ts). Member rows were already owner-only in the
-- database (organization_members_manage_owner; the API writes them with the
-- service role after its checks). Invitations, though, are written with the
-- signed-in user's own client, and org_invitations_manage let an admin write
-- any invitation: through the REST API an admin could still invite a second
-- account of theirs as admin and join with it. The policy now holds admins to
-- the same rule: they can't see an admin invitation to change or delete it,
-- and can't write one (insert, or turn an invitation into one).
drop policy if exists "org_invitations_manage" on public.organization_invitations;

create policy "org_invitations_manage" on public.organization_invitations
for all to authenticated
using (
  (select public.org_role(organization_id)) = 'owner'
  or ((select public.org_role(organization_id)) = 'admin' and role <> 'admin')
)
with check (
  (select public.org_role(organization_id)) = 'owner'
  or ((select public.org_role(organization_id)) = 'admin' and role <> 'admin')
);
