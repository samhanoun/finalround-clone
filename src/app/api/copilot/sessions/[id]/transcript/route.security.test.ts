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

function buildSessionSelect(dataOverride?: Partial<{ id: string; user_id: string; status: string; started_at: string; metadata: { mode: string } }>) {
  return jest.fn().mockResolvedValue({
    data: {
      id: '11111111-1111-1111-1111-111111111111',
      user_id: 'user-1',
      status: 'active',
      started_at: new Date().toISOString(),
      metadata: { mode: 'general' },
      ...(dataOverride ?? {}),
    },
    error: null,
  });
}

function buildSelectChain(single: jest.Mock): { eq: jest.Mock; single: jest.Mock } {
  const chain: { eq: jest.Mock; single: jest.Mock } = {
    eq: jest.fn(() => chain),
    single,
  };

  return chain;
}

describe('copilot transcript route security responses', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('returns session_not_found when session owner does not match authenticated user', async () => {
    const sessionSingle = jest.fn().mockResolvedValue({
      data: {
        id: '11111111-1111-1111-1111-111111111111',
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
      from: jest.fn((table: string) => {
        if (table === 'copilot_sessions') {
          return {
            select: jest.fn(() => buildSelectChain(sessionSingle)),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'content-type': 'application/json',
      }),
      json: async () => ({
        chunks: [{ speaker: 'interviewer', text: 'Tell me about your last project', isFinal: true }],
      }),
    } as unknown as NextRequest;

    const response = await POST(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'session_not_found' });
  });

  it('echoes x-request-id and returns client-safe internal_error payload', async () => {
    const sessionSingle = buildSessionSelect();
    const eventInsertSingle = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
        details: 'sensitive internals should never leak',
      },
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === 'copilot_sessions') {
          return {
            select: jest.fn(() => buildSelectChain(sessionSingle)),
          };
        }

        if (table === 'copilot_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  order: jest.fn(() => ({
                    limit: jest.fn(() => ({
                      returns: jest.fn().mockResolvedValue({ data: [], error: null }),
                    })),
                  })),
                })),
              })),
            })),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: eventInsertSingle,
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': 'req-transcript-123',
      }),
      json: async () => ({
        chunks: [{ speaker: 'interviewer', text: 'Tell me about your last project', isFinal: false }],
      }),
    } as unknown as NextRequest;

    const response = await POST(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-transcript-123' },
    });
  });

  it('accepts interim chunk and skips suggestion generation', async () => {
    const sessionSingle = buildSessionSelect();
    const eventInsertSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'evt-1',
        event_type: 'transcript',
        payload: { text: 'Can you walk me through your approach?', transcript_kind: 'interim' },
        created_at: new Date().toISOString(),
      },
      error: null,
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === 'copilot_sessions') {
          return {
            select: jest.fn(() => buildSelectChain(sessionSingle)),
          };
        }

        if (table === 'copilot_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  order: jest.fn(() => ({
                    limit: jest.fn(() => ({
                      returns: jest.fn().mockResolvedValue({ data: [], error: null }),
                    })),
                  })),
                })),
              })),
            })),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: eventInsertSingle,
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'content-type': 'application/json',
      }),
      json: async () => ({
        chunks: [{ speaker: 'interviewer', text: 'Can you walk me through your approach?', isFinal: false }],
      }),
    } as unknown as NextRequest;

    const response = await POST(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        events: [
          {
            id: 'evt-1',
            event_type: 'transcript',
            payload: { text: 'Can you walk me through your approach?', transcript_kind: 'interim' },
            created_at: expect.any(String),
          },
        ],
        suggestions: [],
        accepted: 1,
        rejected: 0,
      },
      events: [
        {
          id: 'evt-1',
          event_type: 'transcript',
          payload: { text: 'Can you walk me through your approach?', transcript_kind: 'interim' },
          created_at: expect.any(String),
        },
      ],
      suggestions: [],
      accepted: 1,
      rejected: 0,
    });
  });

  it('deduplicates retried interim chunks when interimId matches existing transcript event', async () => {
    const sessionSingle = buildSessionSelect();
    const eventInsertSingle = jest.fn();
    const existingEvent = {
      id: 'evt-existing',
      event_type: 'transcript',
      payload: {
        speaker: 'interviewer',
        text: 'Can you walk me through your approach?',
        transcript_kind: 'interim',
        interim_id: 'int-42',
      },
      created_at: new Date().toISOString(),
    };

    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === 'copilot_sessions') {
          return {
            select: jest.fn(() => buildSelectChain(sessionSingle)),
          };
        }

        if (table === 'copilot_events') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                eq: jest.fn(() => ({
                  order: jest.fn(() => ({
                    limit: jest.fn(() => ({
                      returns: jest.fn().mockResolvedValue({ data: [existingEvent], error: null }),
                    })),
                  })),
                })),
              })),
            })),
            insert: jest.fn(() => ({
              select: jest.fn(() => ({
                single: eventInsertSingle,
              })),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'content-type': 'application/json',
      }),
      json: async () => ({
        chunks: [
          {
            speaker: 'interviewer',
            text: 'Can you walk me through your approach?',
            isFinal: false,
            interimId: 'int-42',
          },
        ],
      }),
    } as unknown as NextRequest;

    const response = await POST(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(eventInsertSingle).not.toHaveBeenCalled();
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        accepted: 1,
        suggestions: [],
        events: [expect.objectContaining({ id: 'evt-existing' })],
      },
    });
  });

  it('rejects whitespace-only chunks in batch payloads', async () => {
    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'content-type': 'application/json',
      }),
      json: async () => ({
        chunks: [{ speaker: 'interviewer', text: '   ', isFinal: false }],
      }),
    } as unknown as NextRequest;

    const response = await POST(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_body',
    });
  });

  it('rejects batch payloads larger than 30 chunks', async () => {
    const { POST } = await import('./route');

    const req = {
      headers: new Headers({
        'content-type': 'application/json',
      }),
      json: async () => ({
        chunks: Array.from({ length: 31 }).map((_, idx) => ({
          speaker: 'interviewer',
          text: `Question ${idx + 1}`,
          isFinal: false,
        })),
      }),
    } as unknown as NextRequest;

    const response = await POST(req, {
      params: Promise.resolve({ id: '11111111-1111-1111-1111-111111111111' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_body',
    });
  });
});
