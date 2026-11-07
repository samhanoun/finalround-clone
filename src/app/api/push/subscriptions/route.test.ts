/** @jest-environment node */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/notify', () => ({ isPushConfigured: () => true }));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

const ENDPOINT = 'https://push.example.test/send/abc123';
const KEYS = { p256dh: 'BPublicKeyOfThisBrowser', auth: 'secret-of-this-browser' };

type Existing = { user_id: string; p256dh: string; auth: string } | null;

function setup({ user = 'user-1', existing = null as Existing, insertError = null as { code: string } | null } = {}) {
  createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) } });
  const writes: Array<{ op: string; row: Record<string, unknown>; where?: Record<string, unknown> }> = [];
  createAdminClient.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
      insert: async (row: Record<string, unknown>) => {
        writes.push({ op: 'insert', row });
        return { error: insertError };
      },
      update: (row: Record<string, unknown>) => {
        const where: Record<string, unknown> = {};
        const write = { op: 'update', row, where };
        writes.push(write);
        const chain = {
          eq: (column: string, value: unknown) => {
            where[column] = value;
            return chain;
          },
          select: async () => {
            const unchanged = existing && where.user_id === existing.user_id && where.auth === existing.auth;
            return { data: unchanged ? [{ id: 'sub-1' }] : [], error: null };
          },
        };
        return chain;
      },
    }),
  });
  return writes;
}

async function post(keys = KEYS) {
  const { POST } = await import('./route');
  const req = { headers: { get: () => 'TestBrowser' }, json: async () => ({ subscription: { endpoint: ENDPOINT, keys } }) } as unknown as NextRequest;
  const res = (await POST(req)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/push/subscriptions', () => {
  it('needs a signed-in user', async () => {
    setup({ user: '' });
    expect((await post()).status).toBe(401);
  });

  it('saves a browser seen for the first time', async () => {
    const writes = setup();
    expect(await post()).toMatchObject({ status: 201, body: { ok: true } });
    expect(writes).toEqual([{ op: 'insert', row: expect.objectContaining({ user_id: 'user-1', endpoint: ENDPOINT, ...KEYS }) }]);
  });

  it('refreshes the keys of a browser already on this account', async () => {
    const writes = setup({ existing: { user_id: 'user-1', p256dh: 'old', auth: 'old-secret' } });
    expect((await post()).status).toBe(201);
    expect(writes[0]).toMatchObject({ op: 'update', row: { user_id: 'user-1', ...KEYS }, where: { endpoint: ENDPOINT, user_id: 'user-1' } });
  });

  it('moves the browser to a new account only when the request carries that browser’s keys', async () => {
    const writes = setup({ existing: { user_id: 'user-2', ...KEYS } });
    expect((await post()).status).toBe(201);
    expect(writes[0]).toMatchObject({ op: 'update', row: { user_id: 'user-1' }, where: { endpoint: ENDPOINT, user_id: 'user-2' } });
  });

  it('refuses to take over another account’s browser by its address alone', async () => {
    const writes = setup({ existing: { user_id: 'user-2', ...KEYS } });
    expect(await post({ p256dh: 'BAttackerKey', auth: 'attacker-secret' })).toMatchObject({ status: 409, body: { error: 'endpoint_in_use' } });
    expect(await post({ p256dh: KEYS.p256dh, auth: 'attacker-secret' })).toMatchObject({ status: 409 });
    expect(writes).toEqual([]);
  });

  it('says the address is taken when another account saved it a moment earlier', async () => {
    setup({ insertError: { code: '23505' } });
    expect(await post()).toMatchObject({ status: 409, body: { error: 'endpoint_in_use' } });
  });
});
