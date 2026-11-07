jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/notify', () => ({ notify: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(async () => true) }));

import { invitePath, isExpired, normalizeEmail, respondToInvitation } from '@/lib/teamInvites';
import { safeNextPath } from '@/lib/safeRedirect';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { notify } = jest.requireMock('@/lib/notify') as { notify: jest.Mock };

const TOKEN = '5f0e8c34-2a51-4d7c-9a0e-3b9d6f1c7e21';

type Row = Record<string, unknown>;

function invitation(overrides: Row = {}): Row {
  return {
    id: 'inv-1',
    organization_id: 'org-1',
    email: 'sam@example.com',
    role: 'member',
    invited_by: 'owner-1',
    token: TOKEN,
    status: 'pending',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockAdmin(found: Row | null, { stillPending = true } = {}) {
  const writes: Array<{ table: string; op: string; row: Row }> = [];
  createAdminClient.mockReturnValue({
    from: (table: string) => {
      const single = async () => {
        if (table === 'organization_invitations') return { data: found };
        if (table === 'organizations') return { data: { name: 'Acme' } };
        if (table === 'profiles') return { data: { full_name: 'Sam Lee', email: 'sam@example.com' } };
        return { data: null };
      };
      return {
        select: () => ({ eq: () => ({ maybeSingle: single }) }),
        upsert: async (row: Row) => {
          writes.push({ table, op: 'upsert', row });
          return { error: null };
        },
        update: (row: Row) => {
          writes.push({ table, op: 'update', row });
          return { eq: () => ({ eq: () => ({ select: async () => ({ data: stillPending ? [{ id: 'inv-1' }] : [], error: null }) }) }) };
        },
      };
    },
  });
  return writes;
}

beforeEach(() => jest.clearAllMocks());

describe('respondToInvitation', () => {
  it('adds the member, marks the invitation used and tells the inviter', async () => {
    const writes = mockAdmin(invitation());
    const result = await respondToInvitation(TOKEN, { id: 'user-2', email: 'Sam@Example.com' }, 'accept');
    expect(result).toEqual({ ok: true, outcome: 'joined', organizationId: 'org-1', teamName: 'Acme' });
    expect(writes).toEqual([
      expect.objectContaining({ table: 'organization_members', op: 'upsert', row: expect.objectContaining({ user_id: 'user-2', role: 'member', status: 'active' }) }),
      { table: 'organization_invitations', op: 'update', row: { status: 'accepted' } },
    ]);
    expect(notify).toHaveBeenCalledWith('owner-1', expect.objectContaining({ type: 'system', url: '/teams' }));
  });

  it('only lets the invited address accept', async () => {
    const writes = mockAdmin(invitation());
    expect(await respondToInvitation(TOKEN, { id: 'user-3', email: 'someone@else.com' }, 'accept')).toEqual({ ok: false, error: 'wrong_account' });
    expect(writes).toEqual([]);
  });

  it('refuses used, cancelled, expired and unknown invitations', async () => {
    mockAdmin(invitation({ status: 'accepted' }));
    expect(await respondToInvitation(TOKEN, { id: 'u', email: 'sam@example.com' }, 'accept')).toEqual({ ok: false, error: 'not_pending' });
    mockAdmin(invitation({ expires_at: '2020-01-01T00:00:00Z' }));
    expect(await respondToInvitation(TOKEN, { id: 'u', email: 'sam@example.com' }, 'accept')).toEqual({ ok: false, error: 'expired' });
    mockAdmin(null);
    expect(await respondToInvitation(TOKEN, { id: 'u', email: 'sam@example.com' }, 'accept')).toEqual({ ok: false, error: 'not_found' });
  });

  it('declines without adding a member', async () => {
    const writes = mockAdmin(invitation());
    const result = await respondToInvitation(TOKEN, { id: 'user-2', email: 'sam@example.com' }, 'decline');
    expect(result).toMatchObject({ ok: true, outcome: 'declined' });
    expect(writes).toEqual([{ table: 'organization_invitations', op: 'update', row: { status: 'cancelled' } }]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify twice when the invitation was used in the meantime', async () => {
    mockAdmin(invitation(), { stillPending: false });
    await respondToInvitation(TOKEN, { id: 'user-2', email: 'sam@example.com' }, 'accept');
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('normalizes addresses and builds links', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
    expect(invitePath('a b')).toBe('/teams/join?token=a%20b');
    expect(isExpired({ expires_at: '2020-01-01T00:00:00Z' })).toBe(true);
  });
});

describe('safeNextPath', () => {
  it('keeps paths on this site', () => {
    expect(safeNextPath('/teams/join?token=abc')).toBe('/teams/join?token=abc');
    expect(safeNextPath('/settings#billing')).toBe('/settings#billing');
  });

  it('refuses other sites and odd forms', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null]) {
      expect(safeNextPath(bad)).toBe('/dashboard');
    }
  });
});
