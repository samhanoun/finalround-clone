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

describe('copilot report route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  it('returns a consistent envelope for normalized report payload', async () => {
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
                    data: { id: 'session-1', user_id: 'user-1', metadata: { mode: 'general' } },
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
});
