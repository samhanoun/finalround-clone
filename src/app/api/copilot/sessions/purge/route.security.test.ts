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

function buildPurgeSupabaseMock(options: { userId?: string; eventsDeleteError?: Record<string, unknown> | null } = {}) {
  const userId = options.userId ?? 'user-1';

  const eventsCountEq = jest.fn().mockResolvedValue({ count: 11, error: null });
  const summariesCountEq = jest.fn().mockResolvedValue({ count: 4, error: null });
  const sessionsCountEq = jest.fn().mockResolvedValue({ count: 3, error: null });
  const activeCountEqStatus = jest.fn().mockResolvedValue({ count: 0, error: null });
  const activeCountEqUser = jest.fn(() => ({ eq: activeCountEqStatus }));

  let sessionsSelectCallCount = 0;

  const eventsDeleteEq = jest.fn().mockResolvedValue({ data: null, error: options.eventsDeleteError ?? null });
  const summariesDeleteEq = jest.fn().mockResolvedValue({ data: null, error: null });
  const sessionsDeleteEq = jest.fn().mockResolvedValue({ data: null, error: null });

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
    from: jest.fn((table: string) => {
      if (table === 'copilot_events') {
        return {
          select: jest.fn(() => ({ eq: eventsCountEq })),
          delete: jest.fn(() => ({ eq: eventsDeleteEq })),
        };
      }

      if (table === 'copilot_summaries') {
        return {
          select: jest.fn(() => ({ eq: summariesCountEq })),
          delete: jest.fn(() => ({ eq: summariesDeleteEq })),
        };
      }

      if (table === 'copilot_sessions') {
        return {
          select: jest.fn(() => {
            sessionsSelectCallCount += 1;
            if (sessionsSelectCallCount === 1) {
              return { eq: sessionsCountEq };
            }
            return { eq: activeCountEqUser };
          }),
          delete: jest.fn(() => ({ eq: sessionsDeleteEq })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe('copilot purge route security responses', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit.mockResolvedValue({ ok: true });
  });

  afterAll(() => {
    consoleSpy.mockRestore();
  });

  it('rejects confirmation_user_mismatch', async () => {
    createClient.mockResolvedValue(buildPurgeSupabaseMock({ userId: 'owner-1' }));

    const { DELETE } = await import('./route');

    const req = {
      headers: new Headers(),
      json: jest.fn().mockResolvedValue({
        confirmation: 'DELETE ALL COPILOT DATA',
        confirmUserId: 'another-user',
      }),
    } as unknown as NextRequest;

    const response = await DELETE(req);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'confirmation_user_mismatch' });
  });

  it('echoes x-request-id and returns client-safe internal_error payload', async () => {
    createClient.mockResolvedValue(
      buildPurgeSupabaseMock({
        eventsDeleteError: {
          code: '42501',
          message: 'permission denied for relation copilot_events',
          details: 'sensitive postgres details',
        },
      }),
    );

    const { DELETE } = await import('./route');

    const req = {
      headers: new Headers({
        'x-request-id': 'req-purge-500',
      }),
      json: jest.fn().mockResolvedValue({
        confirmation: 'DELETE ALL COPILOT DATA',
        confirmUserId: 'user-1',
      }),
    } as unknown as NextRequest;

    const response = await DELETE(req);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'internal_error',
      extra: { requestId: 'req-purge-500' },
    });
  });
});
