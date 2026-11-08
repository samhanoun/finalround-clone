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

type Op = [method: string, ...args: unknown[]];
type Result = { data?: unknown; error?: unknown; count?: number | null };
type Query = { table: string; ops: Op[] };

/**
 * A Supabase client that records each query's chain (from, select, eq, in, …) and answers it with
 * `answer(query)` when it's awaited or ends in maybeSingle/single.
 */
function fakeClient(answer: (query: Query) => Result) {
  const queries: Query[] = [];
  const from = (table: string) => {
    const query: Query = { table, ops: [] };
    queries.push(query);
    const chain: Record<string | symbol, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve().then(() => answer(query)).then(resolve, reject);
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            return async () => {
              query.ops.push([String(prop)]);
              return answer(query);
            };
          }
          return (...args: unknown[]) => {
            query.ops.push([String(prop), ...args]);
            return chain;
          };
        },
      },
    );
    return chain;
  };
  const updateUserById = jest.fn(async (id: string) => ({ data: { user: { id } }, error: null as { message: string } | null }));
  createAdminClient.mockReturnValue({ from, auth: { admin: { updateUserById } } });
  return { queries, updateUserById };
}

const has = (query: Query, method: string) => query.ops.some(([op]) => op === method);
const args = (query: Query, method: string) => query.ops.find(([op]) => op === method)?.slice(1);

const FLAG_ID = '22222222-2222-4222-8222-222222222222';
const FLAGS = [
  { id: 'f1', user_id: 'u1', flag_type: 'chargeback', severity: 'high', description: 'Disputed a charge', resolved: false, created_at: '2026-11-05T00:00:00Z' },
  { id: 'f2', user_id: 'u2', flag_type: 'abuse', severity: 'low', description: 'Spam tickets', resolved: false, created_at: '2026-11-04T00:00:00Z' },
  { id: 'f3', user_id: 'u1', flag_type: 'abuse', severity: 'medium', description: 'Again', resolved: false, created_at: '2026-11-03T00:00:00Z' },
];

async function list() {
  const { GET } = await import('./route');
  const res = (await GET({ url: 'http://localhost/api/admin/fraud?page=1&limit=20&resolved=false' } as NextRequest)) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

async function patch(body: unknown) {
  const { PATCH } = await import('./route');
  const res = (await PATCH({ json: async () => body } as unknown as NextRequest)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/admin/fraud', () => {
  it('loads who each flag is about with a second query, not an embed', async () => {
    const { queries } = fakeClient((query) => {
      if (query.table === 'profiles') {
        return { data: [{ id: 'u1', email: 'one@example.test', full_name: 'One' }, { id: 'u2', email: 'two@example.test', full_name: null }], error: null };
      }
      return has(query, 'range') ? { data: FLAGS, count: FLAGS.length, error: null } : { data: [], error: null };
    });

    const { status, body } = await list();
    expect(status).toBe(200);
    const flagsQuery = queries.find((query) => query.table === 'fraud_flags' && has(query, 'range'))!;
    // fraud_flags.user_id points at auth.users: there is no relationship to profiles to embed.
    expect(String(args(flagsQuery, 'select')?.[0])).not.toContain('profiles');
    expect(args(flagsQuery, 'eq')).toEqual(['resolved', false]);
    const profilesQuery = queries.find((query) => query.table === 'profiles')!;
    expect(args(profilesQuery, 'in')).toEqual(['id', ['u1', 'u2']]);
    expect((body.flags as Array<Record<string, unknown>>).map((flag) => [flag.id, flag.user_email, flag.user_name])).toEqual([
      ['f1', 'one@example.test', 'One'],
      ['f2', 'two@example.test', null],
      ['f3', 'one@example.test', 'One'],
    ]);
  });

  it('fails when the people can’t be loaded, rather than listing flags about nobody', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeClient((query) =>
      query.table === 'profiles' ? { data: null, error: { message: 'timeout' } } : { data: FLAGS, count: FLAGS.length, error: null },
    );
    expect((await list()).status).toBe(500);
    error.mockRestore();
  });
});

describe('PATCH /api/admin/fraud', () => {
  it('suspends the flagged user for real (one body shape: the id on top, the rest under data)', async () => {
    const { queries, updateUserById } = fakeClient((query) =>
      has(query, 'maybeSingle') ? { data: { user_id: 'u1' }, error: null } : { data: null, error: null },
    );

    expect(await patch({ action: 'suspend_user', flag_id: FLAG_ID, data: { description: 'Card testing' } })).toEqual({
      status: 200,
      body: { success: true },
    });
    expect(updateUserById).toHaveBeenCalledWith('u1', { ban_duration: '876000h' });
    const insert = queries.find((query) => has(query, 'insert'))!;
    expect(args(insert, 'insert')?.[0]).toEqual({
      user_id: 'u1',
      flag_type: 'suspicious_activity',
      severity: 'critical',
      description: 'Card testing',
      metadata: { original_flag_id: FLAG_ID, suspended_by: 'staff-1' },
    });
  });

  it('reports a ban that didn’t happen, and records nothing', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { queries, updateUserById } = fakeClient((query) =>
      has(query, 'maybeSingle') ? { data: { user_id: 'u1' }, error: null } : { data: null, error: null },
    );
    updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Auth is down' } } as never);
    expect(await patch({ action: 'suspend_user', flag_id: FLAG_ID })).toEqual({ status: 500, body: { error: 'action_failed' } });
    expect(queries.some((query) => has(query, 'insert'))).toBe(false);
    error.mockRestore();
  });

  it('reports a flag that isn’t there', async () => {
    const { updateUserById } = fakeClient((query) => (has(query, 'maybeSingle') ? { data: null, error: null } : { data: [], error: null }));
    expect(await patch({ action: 'suspend_user', flag_id: FLAG_ID })).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(await patch({ action: 'resolve', flag_id: FLAG_ID })).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('resolves and escalates, and reports a database error', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { queries } = fakeClient((query) => {
      if (has(query, 'maybeSingle')) return { data: { severity: 'medium' }, error: null };
      return { data: [{ id: FLAG_ID }], error: null };
    });
    expect((await patch({ action: 'resolve', flag_id: FLAG_ID })).status).toBe(200);
    expect(args(queries[0], 'update')?.[0]).toMatchObject({ resolved: true, resolved_by: 'staff-1' });
    expect(await patch({ action: 'escalate', flag_id: FLAG_ID })).toEqual({ status: 200, body: { success: true, severity: 'high' } });

    fakeClient(() => ({ data: null, error: { message: 'permission denied' } }));
    expect(await patch({ action: 'resolve', flag_id: FLAG_ID })).toEqual({ status: 500, body: { error: 'action_failed' } });
    error.mockRestore();
  });

  it('refuses a body without the flag id, and unknown actions', async () => {
    fakeClient(() => ({ data: null, error: null }));
    expect((await patch({ action: 'resolve' })).body.error).toBe('invalid_body');
    expect(await patch({ action: 'ban_forever', flag_id: FLAG_ID })).toEqual({ status: 400, body: { error: 'unknown_action' } });
  });
});
