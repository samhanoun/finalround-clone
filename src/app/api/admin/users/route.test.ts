/** @jest-environment node */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/adminAuth', () => ({
  MANAGE_ROLES: ['admin', 'super_admin'],
  requireAdmin: jest.fn(async () => ({ ok: true, userId: 'staff-1', role: 'admin' })),
}));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { requireAdmin } = jest.requireMock('@/lib/adminAuth') as { requireAdmin: jest.Mock };

const PROFILES = [
  { id: 'u-free', email: 'free@example.test', full_name: 'Free User', avatar_url: null, created_at: '2026-11-01T00:00:00Z', updated_at: null },
  { id: 'u-pro', email: 'pro@example.test', full_name: null, avatar_url: null, created_at: '2026-10-01T00:00:00Z', updated_at: null },
];

const USER_ID = '11111111-1111-4111-8111-111111111111';

function setup({ banned = {} as Record<string, string | undefined> } = {}) {
  const calls: { select?: string; or?: string } = {};
  const getUserById = jest.fn(async (id: string) => ({ data: { user: { id, banned_until: banned[id] } }, error: null }));
  const updateUserById = jest.fn(async (id: string) => ({ data: { user: { id } }, error: null as { message: string } | null }));
  const inserts: Array<{ table: string; value: unknown }> = [];
  const upserts: Array<{ table: string; value: unknown; options: unknown }> = [];
  createAdminClient.mockReturnValue({
    auth: { admin: { getUserById, updateUserById } },
    from: (table: string) => {
      if (table === 'profiles') {
        const query = {
          select: (columns: string) => {
            calls.select = columns;
            return query;
          },
          or: (filter: string) => {
            calls.or = filter;
            return query;
          },
          order: () => query,
          range: async () => ({ data: PROFILES, count: PROFILES.length, error: null }),
        };
        return query;
      }
      return {
        select: () => ({
          in: async () => ({
            data: [
              { user_id: 'u-pro', status: 'canceled', stripe_price_id: 'price_old', current_period_end: '2026-06-01T00:00:00Z' },
              { user_id: 'u-pro', status: 'active', stripe_price_id: 'price_1', current_period_end: '2026-12-01T00:00:00Z' },
            ],
            error: null,
          }),
        }),
        insert: async (value: unknown) => {
          inserts.push({ table, value });
          return { error: null };
        },
        upsert: async (value: unknown, options: unknown) => {
          upserts.push({ table, value, options });
          return { error: null };
        },
      };
    },
  });
  return { calls, getUserById, updateUserById, inserts, upserts };
}

async function list(search = '') {
  const { GET } = await import('./route');
  const res = (await GET({ url: `http://localhost/api/admin/users?page=1&limit=20&search=${encodeURIComponent(search)}` } as NextRequest)) as unknown as {
    status: number;
    json: () => Promise<{ users: Array<{ id: string; subscription: unknown; suspended: boolean | null }> }>;
  };
  return { status: res.status, body: await res.json() };
}

async function patch(body: unknown) {
  const { PATCH } = await import('./route');
  const res = (await PATCH({ json: async () => body } as unknown as NextRequest)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'staff-1', role: 'admin' });
});

describe('GET /api/admin/users', () => {
  it('lists every user, with a subscription only for those who have one', async () => {
    const calls = setup().calls;
    const res = await list();
    expect(res.status).toBe(200);
    // No embedded stripe_subscriptions: there is no relationship to embed, and !inner would drop free users.
    expect(calls.select).not.toContain('stripe_subscriptions');
    expect(res.body.users.map((user) => user.id)).toEqual(['u-free', 'u-pro']);
    expect(res.body.users[0].subscription).toBeNull();
    // The running subscription, not an old cancelled one.
    expect(res.body.users[1].subscription).toMatchObject({ status: 'active' });
  });

  it('searches email and name, without characters that would break the filter', async () => {
    const { calls } = setup();
    await list('jane),role.eq.admin,(x*');
    // Only the one comma between the two conditions; no parentheses or wildcards from the term.
    expect(calls.or).toBe('email.ilike.%jane  role.eq.admin  x%,full_name.ilike.%jane  role.eq.admin  x%');
    expect(calls.or?.split(',')).toHaveLength(2);
  });

  it('skips the filter for an empty search', async () => {
    const { calls } = setup();
    await list('  ');
    expect(calls.or).toBeUndefined();
  });

  it('says who is suspended, from Supabase Auth', async () => {
    const { getUserById } = setup({ banned: { 'u-pro': '2126-01-01T00:00:00Z', 'u-free': '2020-01-01T00:00:00Z' } });
    const res = await list();
    expect(getUserById).toHaveBeenCalledTimes(2);
    // A ban that has run out isn't a suspension.
    expect(res.body.users.map((user) => user.suspended)).toEqual([false, true]);
  });

  it('keeps a page to 100 users, since each costs an Auth lookup', async () => {
    setup();
    const { GET } = await import('./route');
    const res = (await GET({ url: 'http://localhost/api/admin/users?page=1&limit=5000' } as NextRequest)) as unknown as {
      json: () => Promise<{ pagination: { limit: number } }>;
    };
    expect((await res.json()).pagination.limit).toBe(100);
  });

  it('still lists users when the sign-in status can’t be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getUserById } = setup();
    getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'User not found' } } as never);
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.users.map((user) => user.suspended)).toEqual([null, false]);
    warn.mockRestore();
  });
});

describe('PATCH /api/admin/users', () => {
  it('suspends with a real ban in Supabase Auth, and records it', async () => {
    const { updateUserById, inserts } = setup();
    expect(await patch({ action: 'suspend_user', user_id: USER_ID })).toEqual({ status: 200, body: { success: true } });
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: '876000h' });
    expect(inserts).toEqual([
      {
        table: 'fraud_flags',
        value: expect.objectContaining({ user_id: USER_ID, description: 'User suspended by admin', metadata: { suspended_by: 'staff-1' } }),
      },
    ]);
  });

  it('lifts the ban to unsuspend', async () => {
    const { updateUserById } = setup();
    expect((await patch({ action: 'unsuspend_user', user_id: USER_ID })).status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, { ban_duration: 'none' });
  });

  it('reports a ban Supabase refused, and records nothing', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { updateUserById, inserts } = setup();
    updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'User not found' } } as never);
    expect(await patch({ action: 'suspend_user', user_id: USER_ID })).toEqual({ status: 500, body: { error: 'action_failed' } });
    expect(inserts).toEqual([]);
    error.mockRestore();
  });

  it('won’t let an admin suspend themselves', async () => {
    const { updateUserById } = setup();
    requireAdmin.mockResolvedValue({ ok: true, userId: USER_ID, role: 'admin' });
    expect(await patch({ action: 'suspend_user', user_id: USER_ID })).toEqual({ status: 400, body: { error: 'cannot_suspend_self' } });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('makes someone staff with the role sent under data (super admins only)', async () => {
    const { upserts } = setup();
    expect(await patch({ action: 'set_admin', user_id: USER_ID, data: { role: 'admin' } })).toEqual({ status: 403, body: { error: 'forbidden' } });

    requireAdmin.mockResolvedValue({ ok: true, userId: 'staff-1', role: 'super_admin' });
    expect(await patch({ action: 'set_admin', user_id: USER_ID, data: { role: 'support_agent' } })).toEqual({ status: 200, body: { success: true } });
    expect(upserts).toEqual([
      { table: 'admin_users', value: { user_id: USER_ID, role: 'support_agent', permissions: ['read', 'write'] }, options: { onConflict: 'user_id' } },
    ]);
    // No data: an admin. An unknown role is refused.
    expect((await patch({ action: 'set_admin', user_id: USER_ID })).status).toBe(200);
    expect(upserts[1].value).toMatchObject({ role: 'admin' });
    expect((await patch({ action: 'set_admin', user_id: USER_ID, data: { role: 'owner' } })).status).toBe(400);
  });

  it('refuses a body in another shape, and actions it doesn’t know', async () => {
    setup();
    expect((await patch({ action: 'suspend_user' })).body.error).toBe('invalid_body');
    expect((await patch({ action: 'suspend_user', user_id: 'not-a-uuid' })).status).toBe(400);
    expect(await patch({ action: 'delete_everything', user_id: USER_ID })).toEqual({ status: 400, body: { error: 'unknown_action' } });
  });
});
