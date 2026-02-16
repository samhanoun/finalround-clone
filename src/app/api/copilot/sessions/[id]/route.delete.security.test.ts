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

type BuildDeleteRouteSupabaseMockOptions = {
  sessionUserId?: string;
  eventsDeleteError?: Record<string, unknown> | null;
};

function buildDeleteRouteSupabaseMock(options: BuildDeleteRouteSupabaseMockOptions = {}) {
  const sessionSingle = jest.fn().mockResolvedValue({
    data: {
      id: '11111111-1111-1111-1111-111111111111',
      user_id: options.sessionUserId ?? 'user-1',
      status: 'stopped',
    },
    error: null,
  });

  const eventsDeleteEqUser = jest.fn().mockResolvedValue({
    data: null,
    error: options.eventsDeleteError ?? null,
  });

  const eventsDeleteEqSession = jest.fn(() => ({
    eq: eventsDeleteEqUser,
  }));

  const summariesDeleteEqUser = jest.fn().mockResolvedValue({ data: null, error: null });
  const summariesDeleteEqSession = jest.fn(() => ({
    eq: summariesDeleteEqUser,
  }));

  const sessionDeleteEqUser = jest.fn().mockResolvedValue({ data: null, error: null });
  const sessionDeleteEqId = jest.fn(() => ({
    eq: sessionDeleteEqUser,
  }));

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
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
          delete: jest.fn(() => ({
            eq: sessionDeleteEqId,
          })),
        };
      }

      if (table === 'copilot_events') {
        return {
          delete: jest.fn(() => ({
            eq: eventsDeleteEqSession,
          })),
        };
      }

      if (table === 'copilot_summaries') {
        return {
          delete: jest.fn(() => ({
            eq: summariesDeleteEqSession,
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe('copilot session delete route security responses', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('returns session_not_found for non-owner requests', async () => {
    const supabase = buildDeleteRouteSupabaseMock({ sessionUserId: 'user-2' });
    createClient.mockResolvedValue(supabase);

    const { DELETE } = await import('./route');

    const req = {
      headers: new Headers({
        'x-request-id': 'req-delete-ownership',
      }),
    } as unknown as NextRequest;

    const response = await DELETE(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'session_not_found',
    });
  });

  it('echoes x-request-id and returns client-safe internal_error payload', async () => {
    const supabase = buildDeleteRouteSupabaseMock({
      eventsDeleteError: {
        code: '42501',
        message: 'permission denied for relation copilot_events',
        details: 'sensitive postgres details',
      },
    });
    createClient.mockResolvedValue(supabase);

    const { DELETE } = await import('./route');

    const req = {
      headers: new Headers({
        'x-request-id': 'req-delete-500',
      }),
    } as unknown as NextRequest;

    const response = await DELETE(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();

    expect(body).toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-delete-500' },
    });
    expect(body.extra).not.toHaveProperty('code');
    expect(body.extra).not.toHaveProperty('message');
    expect(body.extra).not.toHaveProperty('details');
  });
});
