import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/rateLimit', () => ({
  rateLimit: jest.fn(),
}));

const { createClient } = jest.requireMock('@/lib/supabase/server') as {
  createClient: jest.Mock;
};

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as {
  rateLimit: jest.Mock;
};

describe('copilot route integration flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  it('returns history with pagination + consistent envelope', async () => {
    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest
        .fn()
        .mockImplementationOnce(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => ({
                range: jest.fn().mockResolvedValue({
                  data: [{ id: 'session-1', status: 'done', metadata: null }],
                  error: null,
                  count: 1,
                }),
              })),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          select: jest.fn(() => ({
            eq: jest.fn().mockResolvedValue({
              data: [{ duration_seconds: 120, consumed_minutes: 3 }],
              error: null,
            }),
          })),
        })),
    });

    const { GET } = await import('@/app/api/copilot/sessions/history/route');

    const response = await GET(
      {
        headers: new Headers(),
        nextUrl: new URL('https://x.local/api/copilot/sessions/history?page=1&pageSize=10'),
      } as unknown as NextRequest,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        sessions: [{ id: 'session-1', status: 'done', metadata: null }],
        pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
        usage: { total_duration_seconds: 120, total_consumed_minutes: 3 },
      },
      sessions: [{ id: 'session-1', status: 'done', metadata: null }],
    });
  });

  it('returns report_not_found when report payload is missing', async () => {
    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === 'copilot_sessions') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  single: jest.fn().mockResolvedValue({
                    data: { id: 'session-1', user_id: 'user-1', metadata: {} },
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }

        if (table === 'copilot_summaries') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  in: jest.fn(() => ({
                    order: jest.fn(() => ({
                      limit: jest.fn().mockResolvedValue({
                        data: [{ id: 'sum-1', payload: { note: 'missing report fields' } }],
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { GET } = await import('@/app/api/copilot/sessions/[id]/report/route');

    const response = await GET(
      {
        headers: new Headers(),
      } as unknown as NextRequest,
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'report_not_found' });
  });

  it('deletes stopped session and returns deleted payload', async () => {
    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest
        .fn()
        .mockImplementationOnce(() => ({
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn().mockResolvedValue({
                data: { id: 'session-1', user_id: 'user-1', status: 'stopped' },
                error: null,
              }),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          delete: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({ error: null }),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          delete: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({ error: null }),
            })),
          })),
        }))
        .mockImplementationOnce(() => ({
          delete: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn().mockResolvedValue({ error: null }),
            })),
          })),
        })),
    });

    const { DELETE } = await import('@/app/api/copilot/sessions/[id]/route');

    const response = await DELETE(
      {
        headers: new Headers(),
      } as unknown as NextRequest,
      { params: Promise.resolve({ id: 'session-1' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: { sessionId: 'session-1' } });
  });
});
