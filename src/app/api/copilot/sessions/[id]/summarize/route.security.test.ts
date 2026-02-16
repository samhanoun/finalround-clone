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

function buildSummarizeRouteSupabaseMock() {
  const sessionSingle = jest.fn().mockResolvedValue({
    data: {
      id: '22222222-2222-2222-2222-222222222222',
      user_id: 'user-2',
      status: 'active',
      metadata: { mode: 'general' },
    },
    error: null,
  });

  const eventsReturns = jest.fn().mockResolvedValue({
    data: null,
    error: {
      code: 'PGRST116',
      message: 'PostgREST internal message',
      hint: 'Should not appear in API response',
    },
  });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-2' } },
        error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === 'copilot_sessions') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: sessionSingle,
            })),
          })),
        };
      }

      if (table === 'copilot_events') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                limit: jest.fn(() => ({
                  returns: eventsReturns,
                })),
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe('copilot summarize route security responses', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('returns internal_error with provided request id and no leaked internals', async () => {
    const supabase = buildSummarizeRouteSupabaseMock();
    createClient.mockResolvedValue(supabase);

    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'x-request-id': 'req-summary-123',
      }),
    } as unknown as Request;

    const response = await POST(req, {
      params: Promise.resolve({ id: '22222222-2222-2222-2222-222222222222' }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();

    expect(body).toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-summary-123' },
    });
    expect(body.extra).not.toHaveProperty('code');
    expect(body.extra).not.toHaveProperty('message');
    expect(body.extra).not.toHaveProperty('hint');
  });

  it('generates request id when request header is missing', async () => {
    const supabase = buildSummarizeRouteSupabaseMock();
    createClient.mockResolvedValue(supabase);

    const uuidSpy = jest.spyOn(global.crypto, 'randomUUID').mockReturnValue('generated-summary-request-id');
    const { POST } = await import('./route');

    const req = {
      headers: new Headers(),
    } as unknown as Request;

    const response = await POST(req, {
      params: Promise.resolve({ id: '22222222-2222-2222-2222-222222222222' }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: 'internal_error',
      extra: { requestId: 'generated-summary-request-id' },
    });

    uuidSpy.mockRestore();
  });
});
