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

type BuildReportSupabaseMockOptions = {
  sessionData?: Record<string, unknown> | null;
  summaryError?: Record<string, unknown> | null;
};

function buildReportSupabaseMock(options: BuildReportSupabaseMockOptions = {}) {
  return {
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
                  data:
                    options.sessionData === undefined
                      ? { id: 'session-1', user_id: 'user-1', metadata: { mode: 'general' } }
                      : options.sessionData,
                  error: options.sessionData === null ? { code: 'PGRST116' } : null,
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
                    limit: jest.fn().mockResolvedValue(
                      options.summaryError
                        ? {
                            data: null,
                            error: options.summaryError,
                          }
                        : {
                            data: [
                              {
                                id: 'sum-1',
                                summary_type: 'mock_interview_report',
                                content: 'summary',
                                payload: {
                                  overall_score: 88,
                                  summary: 'Strong communication and structure.',
                                  strengths: ['clarity'],
                                  weaknesses: ['depth'],
                                  next_steps: ['practice'],
                                  rubric: {
                                    communication: { score: 4, evidence: 'Clear', recommendation: 'Keep concise' },
                                  },
                                },
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                              },
                            ],
                            error: null,
                          },
                    ),
                  })),
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

describe('copilot report route', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('returns a consistent envelope for normalized report payload', async () => {
    createClient.mockResolvedValue(buildReportSupabaseMock());

    const { GET } = await import('./route');

    const req = {
      headers: new Headers(),
    } as unknown as NextRequest;

    const response = await GET(req, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        report: expect.any(Object),
        summary: expect.objectContaining({ id: 'sum-1' }),
      },
      report: expect.any(Object),
      summary: expect.objectContaining({ id: 'sum-1' }),
    });
  });

  it('returns session_not_found for non-owner access', async () => {
    createClient.mockResolvedValue(buildReportSupabaseMock({ sessionData: null }));

    const { GET } = await import('./route');

    const req = {
      headers: new Headers(),
    } as unknown as NextRequest;

    const response = await GET(req, {
      params: Promise.resolve({ id: 'session-foreign' }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'session_not_found' });
  });

  it('echoes x-request-id and returns safe internal_error payload on summary db failure', async () => {
    createClient.mockResolvedValue(
      buildReportSupabaseMock({
        summaryError: {
          code: '42501',
          message: 'permission denied for relation copilot_summaries',
          details: 'sensitive db details',
        },
      }),
    );

    const { GET } = await import('./route');

    const req = {
      headers: new Headers({
        'x-request-id': 'req-report-500',
      }),
    } as unknown as NextRequest;

    const response = await GET(req, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-report-500' },
    });
  });
});
