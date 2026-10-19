jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

import { MANAGE_ROLES, requireAdmin } from '@/lib/adminAuth';

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

function signedInAs(userId: string | null) {
  createClient.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }) },
  });
}

function adminRowIs(role: string | null) {
  createAdminClient.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: role ? { role } : null }),
        }),
      }),
    }),
  });
}

async function statusOf(result: Awaited<ReturnType<typeof requireAdmin>>) {
  return result.ok ? 200 : result.response.status;
}

describe('requireAdmin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects signed-out callers with 401', async () => {
    signedInAs(null);
    adminRowIs('super_admin');
    expect(await statusOf(await requireAdmin())).toBe(401);
  });

  it('rejects signed-in users without an admin_users row with 403', async () => {
    signedInAs('user-1');
    adminRowIs(null);
    expect(await statusOf(await requireAdmin())).toBe(403);
  });

  it('lets a support agent through when no roles are required', async () => {
    signedInAs('agent-1');
    adminRowIs('support_agent');
    const result = await requireAdmin();
    expect(result).toEqual({ ok: true, userId: 'agent-1', role: 'support_agent' });
  });

  it('blocks a support agent from manage-only handlers', async () => {
    signedInAs('agent-1');
    adminRowIs('support_agent');
    expect(await statusOf(await requireAdmin(MANAGE_ROLES))).toBe(403);
  });

  it.each(['admin', 'super_admin'])('allows %s on manage-only handlers', async (role) => {
    signedInAs('admin-1');
    adminRowIs(role);
    expect(await requireAdmin(MANAGE_ROLES)).toEqual({ ok: true, userId: 'admin-1', role });
  });
});
