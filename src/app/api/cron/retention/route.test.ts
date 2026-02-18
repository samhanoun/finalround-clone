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

  it('returns 401 when cronKey is missing', async () => {
    const { GET } = await import('./route');

    const req = {
      url: 'http://localhost/api/cron/retention',
    } as unknown as NextRequest;

    const response = await GET(req);

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when cronKey is invalid', async () => {
    const { GET } = await import('./route');

    const req = {
      url: 'http://localhost/api/cron/retention?cronKey=wrong-key',
    } as unknown as NextRequest;

    const response = await GET(req);

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns dry-run evidence by default with valid cronKey', async () => {
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

    const req = {
      url: 'http://localhost/api/cron/retention?cronKey=test-cron-secret-key-123456789012345',
    } as unknown as NextRequest;

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

  it('executes actual deletion when dryRun=false with valid cronKey', async () => {
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

    const req = {
      url: 'http://localhost/api/cron/retention?dryRun=false&cronKey=test-cron-secret-key-123456789012345',
    } as unknown as NextRequest;

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

    const req = {
      url: 'http://localhost/api/cron/retention?cronKey=test-cron-secret-key-123456789012345',
    } as unknown as NextRequest;

    const response = await GET(req);

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe('Database connection failed');
    expect(json.message).toContain('failed');
  });

  it('supports POST method with valid cronKey', async () => {
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

    const req = {
      url: 'http://localhost/api/cron/retention?cronKey=test-cron-secret-key-123456789012345',
    } as unknown as NextRequest;

    const response = await POST(req);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.dryRun).toBe(true);
  });
});
