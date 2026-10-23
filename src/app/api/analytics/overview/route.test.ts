jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
      json: async () => body,
    }),
  },
}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

import { OVERVIEW_ROW_LIMIT } from '@/lib/analytics/overview';

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };

type Result = { data: unknown[] | null; error: unknown };

/** A chainable query that records its calls and resolves on limit(). */
function query(result: Result) {
  const calls: unknown[][] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'order']) {
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.limit = (...args) => {
    calls.push(['limit', ...args]);
    return Promise.resolve(result);
  };
  return { builder, calls };
}

function mockSupabase(
  results: Partial<Record<'copilot_sessions' | 'interview_sessions' | 'interview_reports', Result>> = {},
  user: { id: string } | null = { id: 'user-1' }
) {
  const queries: Record<string, ReturnType<typeof query>> = {};
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table: keyof typeof results) => {
      queries[table] = query(results[table] ?? { data: [], error: null });
      return queries[table].builder;
    },
  });
  return queries;
}

async function call() {
  const { GET } = await import('./route');
  const res = (await GET()) as unknown as {
    status: number;
    headers: Record<string, string>;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, headers: res.headers, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/analytics/overview', () => {
  it('refuses a signed-out caller', async () => {
    const queries = mockSupabase({}, null);
    expect((await call()).status).toBe(401);
    expect(queries).toEqual({});
  });

  it("returns only the caller's own rows from the lookback window, never cached", async () => {
    const live = [{ started_at: '2026-10-20T10:00:00.000Z', consumed_minutes: 12 }];
    const practice = [{ created_at: '2026-10-19T10:00:00.000Z' }];
    const reports = [{ generated_at: '2026-10-19T11:00:00.000Z', overall_score: 74 }];
    const queries = mockSupabase({
      copilot_sessions: { data: live, error: null },
      interview_sessions: { data: practice, error: null },
      interview_reports: { data: reports, error: null },
    });

    const { status, headers, body } = await call();

    expect(status).toBe(200);
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(body).toMatchObject({ truncated: false, liveSessions: live, practiceInterviews: practice, reports });
    for (const [table, column] of [
      ['copilot_sessions', 'started_at'],
      ['interview_sessions', 'created_at'],
      ['interview_reports', 'generated_at'],
    ]) {
      expect(queries[table].calls).toContainEqual(['eq', 'user_id', 'user-1']);
      expect(queries[table].calls).toContainEqual(['gte', column, body.since]);
      expect(queries[table].calls).toContainEqual(['limit', OVERVIEW_ROW_LIMIT]);
    }
  });

  it('says when a list hit the row cap', async () => {
    const full = Array.from({ length: OVERVIEW_ROW_LIMIT }, () => ({ created_at: '2026-10-19T10:00:00.000Z' }));
    mockSupabase({ interview_sessions: { data: full, error: null } });
    expect((await call()).body.truncated).toBe(true);
  });

  it('fails loudly instead of returning partial numbers', async () => {
    mockSupabase({ interview_reports: { data: null, error: { message: 'boom' } } });
    const { status, body } = await call();
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Failed to fetch analytics overview' });
  });
});
