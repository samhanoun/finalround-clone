import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as { rateLimit: jest.Mock };
const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

/**
 * A query builder that records each call and its filters. `rows` is what the
 * session update or delete matches (none: someone else's interview, or gone).
 */
function mockSupabase({ rows = [{ id: 'iv-1', title: 'Renamed' }], user = { id: 'user-1' } as { id: string } | null } = {}) {
  const calls: Call[] = [];
  const builder = (table: string, op: string, payload?: unknown) => {
    const call: Call = { table, op, payload, filters: [] };
    calls.push(call);
    const result = () => ({ data: table === 'interview_sessions' ? rows : null, error: null });
    const chain = {
      eq: (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return chain;
      },
      select: () => chain,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => ({
      update: (payload: unknown) => builder(table, 'update', payload),
      delete: () => builder(table, 'delete'),
      select: () => builder(table, 'select'),
    }),
  });
  return calls;
}

const params = { params: Promise.resolve({ id: 'iv-1' }) };
const request = (body?: unknown) => ({ headers: new Headers(), json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true });
});

describe('PATCH /api/interviews/[id] (rename)', () => {
  it('renames only the signed-in user’s own interview, and only its title', async () => {
    const calls = mockSupabase();
    const { PATCH } = await import('./route');
    const res = await PATCH(request({ title: '  Staff Engineer at Acme  ', status: 'completed', meta: { practice: {} } }), params);

    expect(res.status).toBe(200);
    expect(calls).toEqual([
      {
        table: 'interview_sessions',
        op: 'update',
        payload: { title: 'Staff Engineer at Acme' },
        filters: [
          ['id', 'iv-1'],
          ['user_id', 'user-1'],
        ],
      },
    ]);
  });

  it('answers 404 for an interview that isn’t yours, and 400 for an empty name', async () => {
    mockSupabase({ rows: [] });
    const { PATCH } = await import('./route');
    expect((await PATCH(request({ title: 'Mine now' }), params)).status).toBe(404);
    expect((await PATCH(request({ title: '   ' }), params)).status).toBe(400);
    expect((await PATCH(request({ title: 'x'.repeat(201) }), params)).status).toBe(400);
  });

  it('needs a signed-in user', async () => {
    mockSupabase({ user: null });
    const { PATCH } = await import('./route');
    expect((await PATCH(request({ title: 'New name' }), params)).status).toBe(401);
  });
});

describe('DELETE /api/interviews/[id]', () => {
  it('deletes your interview, then its questions and reports, all limited to you', async () => {
    const calls = mockSupabase({ rows: [{ id: 'iv-1', title: 'x' }] });
    const { DELETE } = await import('./route');
    const res = await DELETE(request(), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(calls.map(({ table, op, filters }) => ({ table, op, filters }))).toEqual([
      { table: 'interview_sessions', op: 'delete', filters: [['id', 'iv-1'], ['user_id', 'user-1']] },
      { table: 'interview_questions', op: 'delete', filters: [['session_id', 'iv-1'], ['user_id', 'user-1']] },
      { table: 'interview_reports', op: 'delete', filters: [['session_id', 'iv-1'], ['user_id', 'user-1']] },
    ]);
  });

  it('answers 404, deleting nothing else, for an interview that isn’t yours', async () => {
    const calls = mockSupabase({ rows: [] });
    const { DELETE } = await import('./route');
    expect((await DELETE(request(), params)).status).toBe(404);
    expect(calls.map((call) => call.table)).toEqual(['interview_sessions']);
  });
});
