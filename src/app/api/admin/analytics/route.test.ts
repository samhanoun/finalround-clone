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
type Query = { table: string; ops: Op[] };

/** Records each count query and answers it with `count(query)`. */
function fakeClient(count: (query: Query) => number | { error: { message: string } }) {
  const queries: Query[] = [];
  createAdminClient.mockReturnValue({
    from: (table: string) => {
      const query: Query = { table, ops: [] };
      queries.push(query);
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lte']) {
        chain[method] = (...args: unknown[]) => {
          query.ops.push([method, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) => {
        const answer = count(query);
        return Promise.resolve(typeof answer === 'number' ? { count: answer, data: null, error: null } : { count: null, data: null, ...answer }).then(resolve);
      };
      return chain;
    },
  });
  return queries;
}

const filter = (query: Query) => query.ops.filter(([op]) => op !== 'select');

async function get(period = '30d') {
  const { GET } = await import('./route');
  const res = (await GET({ url: `http://localhost/api/admin/analytics?period=${period}` } as NextRequest)) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/admin/analytics', () => {
  it('counts the live tables: users, sign-ups, subscriptions, open tickets and open fraud flags', async () => {
    const queries = fakeClient((query) => {
      if (query.table === 'profiles') return query.ops.some(([op]) => op === 'gte') ? 4 : 120;
      if (query.table === 'stripe_subscriptions') return 9;
      if (query.table === 'support_tickets') return 3;
      return 2;
    });

    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.totals).toEqual({ totalUsers: 120, newUsers: 4, activeSubscriptions: 9, openTickets: 3, openFraudFlags: 2 });
    expect(body.period).toMatchObject({ days: 30 });

    // Counts only (head: true), never the rows.
    for (const query of queries) expect(query.ops[0]).toEqual(['select', '*', { count: 'exact', head: true }]);
    // No made-up aggregate table, and no revenue guessed from a count.
    expect(queries.map((query) => query.table)).not.toContain('daily_usage_stats');
    expect(body.totals).not.toHaveProperty('mrr');

    const byTable = (table: string) => queries.filter((query) => query.table === table).map(filter);
    expect(byTable('stripe_subscriptions')).toEqual([[['in', 'status', ['active', 'trialing']]]]);
    expect(byTable('support_tickets')).toEqual([[['in', 'status', ['open', 'in_progress', 'waiting_user']]]]);
    expect(byTable('fraud_flags')).toEqual([[['eq', 'resolved', false]]]);
    const signups = byTable('profiles')[1][0];
    expect(signups[0]).toBe('gte');
    const since = Date.parse(String(signups[2]));
    expect(Math.round((Date.now() - since) / 86_400_000)).toBe(30);
  });

  it('counts sign-ups over the period asked for', async () => {
    fakeClient(() => 1);
    expect((await get('7d')).body.period).toMatchObject({ days: 7 });
    expect((await get('nonsense')).body.period).toMatchObject({ days: 30 });
  });

  it('fails rather than showing a zero it couldn’t count', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeClient((query) => (query.table === 'support_tickets' ? { error: { message: 'timeout' } } : 1));
    expect(await get()).toEqual({ status: 500, body: { error: 'load_failed' } });
    error.mockRestore();
  });
});
