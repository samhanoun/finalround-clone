import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

jest.mock('@/lib/copilotRetention', () => ({
  runCopilotRetentionSweep: jest.fn(),
  buildCopilotRetentionCutoffs: jest.fn(() => ({
    policy: { eventsDays: 30, summariesDays: 90, sessionsDays: 90 },
    cutoffs: {
      eventsBeforeIso: '2026-01-19T00:00:00.000Z',
      summariesBeforeIso: '2025-11-20T00:00:00.000Z',
      sessionsBeforeIso: '2025-11-20T00:00:00.000Z',
    },
  })),
}));

jest.mock('@/lib/env', () => ({
  ...jest.requireActual('@/lib/env'),
  requireEnv: jest.fn((key: string) => {
    if (key === 'CRON_SECRET') {
      return 'test-cron-secret-key-123456789012345';
    }
    throw new Error(`Missing env var: ${key}`);
  }),
}));

const SECRET = 'test-cron-secret-key-123456789012345';

/** A cron call, with the secret as a bearer token (never in the URL). */
function cronRequest(url: string, token?: string) {
  return { url, headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}) } as unknown as NextRequest;
}

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as {
  createAdminClient: jest.Mock;
};
const { runCopilotRetentionSweep } = jest.requireMock('@/lib/copilotRetention') as {
  runCopilotRetentionSweep: jest.Mock;
};

describe('/api/cron/retention', () => {
  const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('returns 401 without the bearer token', async () => {
    const { GET } = await import('./route');

    const req = cronRequest('http://localhost/api/cron/retention');

    const response = await GET(req);

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('refuses the secret in the query string (URLs end up in logs)', async () => {
    const { GET } = await import('./route');
    const response = await GET({ url: `http://localhost/api/cron/retention?cronKey=${SECRET}`, headers: new Headers() } as unknown as NextRequest);
    expect(response.status).toBe(401);
  });

  it('returns 401 with a wrong token', async () => {
    const { GET } = await import('./route');

    const req = cronRequest('http://localhost/api/cron/retention', 'wrong-key');

    const response = await GET(req);

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns dry-run evidence by default with the right token', async () => {
    runCopilotRetentionSweep.mockResolvedValue({
      dryRun: true,
      policy: { eventsDays: 30, summariesDays: 90, sessionsDays: 90 },
      cutoffs: {
        eventsBeforeIso: '2026-01-19T00:00:00.000Z',
        summariesBeforeIso: '2025-11-20T00:00:00.000Z',
        sessionsBeforeIso: '2025-11-20T00:00:00.000Z',
      },
      deleted: { events: 0, summaries: 0, sessions: 0 },
    });

    createAdminClient.mockReturnValue({} as never);

    const { GET } = await import('./route');

    const req = cronRequest('http://localhost/api/cron/retention', SECRET);

    const response = await GET(req);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.dryRun).toBe(true);
    expect(json.message).toContain('Dry-run completed');
    expect(runCopilotRetentionSweep).toHaveBeenCalledWith(expect.any(Object), {
      now: expect.any(Date),
      dryRun: true,
    });
  });

  it('executes actual deletion when dryRun=false with the right token', async () => {
    runCopilotRetentionSweep.mockResolvedValue({
      dryRun: false,
      policy: { eventsDays: 30, summariesDays: 90, sessionsDays: 90 },
      cutoffs: {
        eventsBeforeIso: '2026-01-19T00:00:00.000Z',
        summariesBeforeIso: '2025-11-20T00:00:00.000Z',
        sessionsBeforeIso: '2025-11-20T00:00:00.000Z',
      },
      deleted: { events: 5, summaries: 2, sessions: 1 },
    });

    createAdminClient.mockReturnValue({} as never);

    const { GET } = await import('./route');

    const req = cronRequest('http://localhost/api/cron/retention?dryRun=false', SECRET);

    const response = await GET(req);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.dryRun).toBe(false);
    expect(json.deleted).toEqual({ events: 5, summaries: 2, sessions: 1 });
    expect(runCopilotRetentionSweep).toHaveBeenCalledWith(expect.any(Object), {
      now: expect.any(Date),
      dryRun: false,
    });
  });

  it('handles errors gracefully', async () => {
    runCopilotRetentionSweep.mockRejectedValue(new Error('Database connection failed'));

    createAdminClient.mockReturnValue({} as never);

    const { GET } = await import('./route');

    const req = cronRequest('http://localhost/api/cron/retention', SECRET);

    const response = await GET(req);

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe('Database connection failed');
    expect(json.message).toContain('failed');
  });

  it('supports POST method with the right token', async () => {
    runCopilotRetentionSweep.mockResolvedValue({
      dryRun: true,
      policy: { eventsDays: 30, summariesDays: 90, sessionsDays: 90 },
      cutoffs: {
        eventsBeforeIso: '2026-01-19T00:00:00.000Z',
        summariesBeforeIso: '2025-11-20T00:00:00.000Z',
        sessionsBeforeIso: '2025-11-20T00:00:00.000Z',
      },
      deleted: { events: 0, summaries: 0, sessions: 0 },
    });

    createAdminClient.mockReturnValue({} as never);

    const { POST } = await import('./route');

    const req = cronRequest('http://localhost/api/cron/retention', SECRET);

    const response = await POST(req);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.dryRun).toBe(true);
  });
});
