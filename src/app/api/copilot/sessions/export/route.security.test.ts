import type { NextRequest } from 'next/server';

jest.mock('next/server', () => {
  class NextResponseMock {
    status: number;
    headers: Map<string, string>;
    private payload: string;

    constructor(body: string, init?: { status?: number; headers?: Record<string, string> }) {
      this.status = init?.status ?? 200;
      this.headers = new Map(Object.entries(init?.headers ?? {}));
      this.payload = body;
    }

    static json(body: unknown, init?: { status?: number }) {
      return {
        status: init?.status ?? 200,
        json: async () => body,
      };
    }

    async json() {
      return JSON.parse(this.payload);
    }
  }

  return { NextResponse: NextResponseMock };
});

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

describe('copilot export route security responses', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('returns unauthorized when user is missing', async () => {
    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    });

    const { GET } = await import('./route');

    const req = {
      headers: new Headers(),
    } as unknown as NextRequest;

    const response = await GET(req);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('echoes x-request-id and returns client-safe internal_error payload on db failure', async () => {
    const sessionsOrder = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for relation copilot_sessions' },
    });

    const eventsOrder = jest.fn().mockResolvedValue({ data: [], error: null });
    const summariesOrder = jest.fn().mockResolvedValue({ data: [], error: null });

    createClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: jest.fn((table: string) => {
        if (table === 'copilot_sessions') {
          return {
            select: jest.fn(() => ({ eq: jest.fn(() => ({ order: sessionsOrder })) })),
          };
        }

        if (table === 'copilot_events') {
          return {
            select: jest.fn(() => ({ eq: jest.fn(() => ({ order: eventsOrder })) })),
          };
        }

        if (table === 'copilot_summaries') {
          return {
            select: jest.fn(() => ({ eq: jest.fn(() => ({ order: summariesOrder })) })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const { GET } = await import('./route');

    const req = {
      headers: new Headers({
        'x-request-id': 'req-export-500',
      }),
    } as unknown as NextRequest;

    const response = await GET(req);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-export-500' },
    });
  });
});
