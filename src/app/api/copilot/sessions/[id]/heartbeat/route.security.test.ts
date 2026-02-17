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

describe('copilot heartbeat route security responses', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('returns session_not_found for non-owner access', async () => {
    const sessionSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'session-1',
        user_id: 'user-2',
        status: 'active',
        started_at: new Date().toISOString(),
        metadata: { mode: 'general' },
      },
      error: null,
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: sessionSingle,
          })),
        })),
      })),
    });

    const { POST } = await import('./route');

    const response = await POST(
      {
        headers: new Headers({ 'content-type': 'application/json' }),
      } as unknown as NextRequest,
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'session_not_found' });
  });

  it('returns internal_error envelope with requestId when heartbeat write fails', async () => {
    const sessionSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'session-1',
        user_id: 'user-1',
        status: 'active',
        started_at: new Date().toISOString(),
        metadata: { mode: 'general' },
      },
      error: null,
    });

    const updateEq = jest.fn(() => ({
      eq: jest.fn(() => ({
        eq: jest.fn().mockResolvedValue({
          error: {
            code: '23505',
            message: 'sensitive backend details',
          },
        }),
      })),
    }));

    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === 'copilot_sessions') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: sessionSingle,
              })),
            })),
            update: jest.fn(() => ({
              eq: updateEq,
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { POST } = await import('./route');

    const response = await POST(
      {
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-heartbeat-1',
        }),
      } as unknown as NextRequest,
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-heartbeat-1' },
    });
  });
});
