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

function buildEventsRouteSupabaseMock() {
  const sessionSingle = jest.fn().mockResolvedValue({
    data: {
      id: '11111111-1111-1111-1111-111111111111',
      user_id: 'user-1',
      status: 'active',
      started_at: new Date().toISOString(),
      metadata: { mode: 'general', consent_status: 'granted', consent_granted_at: new Date().toISOString() },
    },
    error: null,
  });

  const eventInsertSingle = jest.fn().mockResolvedValue({
    data: null,
    error: {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      details: 'sensitive internals should never leak',
    },
  });

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
        };
      }

      if (table === 'copilot_events') {
        return {
          insert: jest.fn(() => ({
            select: jest.fn(() => ({
              single: eventInsertSingle,
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe('copilot events route security responses', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('echoes x-request-id and returns client-safe internal_error payload', async () => {
    const supabase = buildEventsRouteSupabaseMock();
    createClient.mockResolvedValue(supabase);

    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': 'req-events-123',
      }),
      json: async () => ({
        eventType: 'transcript',
        speaker: 'interviewer',
        text: 'Tell me about a project decision.',
      }),
    } as unknown as NextRequest;

    const response = await POST(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();

    expect(body).toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-events-123' },
    });
    expect(body.extra).not.toHaveProperty('code');
    expect(body.extra).not.toHaveProperty('message');
    expect(body.extra).not.toHaveProperty('details');
  });

  it('generates requestId when x-request-id is missing', async () => {
    const supabase = buildEventsRouteSupabaseMock();
    createClient.mockResolvedValue(supabase);

    const uuidSpy = jest.spyOn(global.crypto, 'randomUUID').mockReturnValue('generated-events-request-id');
    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'content-type': 'application/json',
      }),
      json: async () => ({
        eventType: 'transcript',
        speaker: 'interviewer',
        text: 'Follow up question',
      }),
    } as unknown as NextRequest;

    const response = await POST(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: 'internal_error',
      extra: { requestId: 'generated-events-request-id' },
    });

    uuidSpy.mockRestore();
  });
});
