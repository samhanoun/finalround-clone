import { canManageRole } from '@/lib/teamRoles';

describe('canManageRole', () => {
  it('lets an owner manage admins, members and viewers, and nobody an owner', () => {
    expect(['admin', 'member', 'viewer'].map((role) => canManageRole('owner', role))).toEqual([true, true, true]);
    expect(canManageRole('owner', 'owner')).toBe(false);
  });

  it('lets an admin manage members and viewers, but not another admin, nor make one', () => {
    expect(['admin', 'member', 'viewer', 'owner'].map((role) => canManageRole('admin', role))).toEqual([false, true, true, false]);
  });

  it('lets members, viewers and people outside the team manage nobody', () => {
    for (const actor of ['member', 'viewer', null, undefined] as const) {
      expect(['admin', 'member', 'viewer'].some((role) => canManageRole(actor, role))).toBe(false);
    }
  });

  it('refuses a role it doesn’t know', () => {
    expect(canManageRole('owner', 'boss')).toBe(false);
    expect(canManageRole('owner', '')).toBe(false);
  });
});
