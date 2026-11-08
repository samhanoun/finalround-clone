import type { OrganizationRole } from '@/lib/organizations';

/**
 * Who may manage whom in a team. The members and invitations routes enforce it
 * and the Teams page offers only what it allows (no dependencies, so the
 * browser imports it too); migration 0034 applies the same rule to
 * invitations in the database.
 * - Nobody manages an owner, and ownership isn't handed out.
 * - Owners manage admins, members and viewers.
 * - Admins manage members and viewers only: an admin can't remove or demote
 *   another admin, make anyone an admin, or touch an invitation as admin.
 *
 * `role` is the role someone has (to change or remove them, or their
 * invitation) or the one they'd get (to grant it). An unknown role is refused.
 */
export function canManageRole(actor: OrganizationRole | null | undefined, role: string): boolean {
  if (role !== 'admin' && role !== 'member' && role !== 'viewer') return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && role !== 'admin';
}
