import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/rateLimit', () => ({
  rateLimit: jest.fn(),
}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as {
  rateLimit: jest.Mock;
};
const { createClient } = jest.requireMock('@/lib/supabase/server') as {
  createClient: jest.Mock;
};

type BuildHistorySupabaseMockOptions = {
  sessionsError?: Record<string, unknown> | null;
};

function buildHistorySupabaseMock(options: BuildHistorySupabaseMockOptions = {}) {
  const sessionsEq = jest.fn(() => ({
    order: jest.fn(() => ({
      range: jest.fn().mockResolvedValue({
        data: options.sessionsError ? null : [{ id: 'session-1', user_id: 'user-1' }],
        error: options.sessionsError ?? null,
        count: options.sessionsError ? null : 1,
      }),
    })),
    contains: jest.fn(),
    gte: jest.fn(),
    lte: jest.fn(),
  }));

  const aggregateEq = jest.fn(() => ({
    then: undefined,
    contains: jest.fn(),
    gte: jest.fn(),
    lte: jest.fn(),
  }));

  const aggregateQuery = {
    eq: aggregateEq,
    then: (resolve: (value: unknown) => unknown) =>
      resolve({
        data: [{ duration_seconds: 60, consumed_minutes: 1 }],
        error: null,
      }),
  };

  const supabase = {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === 'copilot_sessions') {
        return {
          select: jest.fn((columns: string) => {
            if (columns.includes('title')) {
              return {
                eq: sessionsEq,
                order: jest.fn(),
                range: jest.fn(),
                contains: jest.fn(),
                gte: jest.fn(),
                lte: jest.fn(),
              };
            }

            return aggregateQuery;
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, sessionsEq, aggregateEq };
}

describe('copilot history route security responses', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('returns safe internal_error payload and propagates request id on sessions query failure', async () => {
    const { supabase } = buildHistorySupabaseMock({
      sessionsError: {
        code: '42501',
        message: 'permission denied for relation copilot_sessions',
        details: 'sensitive details',
      },
    });
    createClient.mockResolvedValue(supabase);

    const { GET } = await import('./route');

    const req = {
      headers: new Headers({
        'x-request-id': 'req-history-500',
      }),
      nextUrl: new URL('https://example.com/api/copilot/sessions/history?page=1&pageSize=30'),
    } as unknown as NextRequest;

    const response = await GET(req);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-history-500' },
    });
    expect(body.extra).not.toHaveProperty('code');
    expect(body.extra).not.toHaveProperty('message');
    expect(body.extra).not.toHaveProperty('details');
  });

  it('scopes history queries to authenticated owner user_id', async () => {
    const { supabase, sessionsEq, aggregateEq } = buildHistorySupabaseMock();
    createClient.mockResolvedValue(supabase);

    const { GET } = await import('./route');

    const req = {
      headers: new Headers(),
      nextUrl: new URL('https://example.com/api/copilot/sessions/history?page=1&pageSize=30'),
    } as unknown as NextRequest;

    const response = await GET(req);

    expect(response.status).toBe(200);
    expect(sessionsEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(aggregateEq).toHaveBeenCalledWith('user_id', 'user-1');
  });
});
