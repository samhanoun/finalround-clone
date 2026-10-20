import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/copilot', () => ({
  ...jest.requireActual('@/lib/copilot'),
  getCopilotQuotaSnapshot: jest.fn(),
  recordCopilotUsage: jest.fn(),
}));

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as { rateLimit: jest.Mock };
const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { getCopilotQuotaSnapshot } = jest.requireMock('@/lib/copilot') as { getCopilotQuotaSnapshot: jest.Mock };

const SESSION_ID = '7f1c2a9e-3b4d-4c5e-8f60-1a2b3c4d5e6f';

function latencyRow(speechToFirstToken: number, outcome = 'answered') {
  return {
    payload: {
      kind: 'latency',
      speech_to_final: 300,
      final_to_gate: 10,
      gate_to_first_token: speechToFirstToken - 310,
      first_token_to_done: 1500,
      speech_to_first_token: speechToFirstToken,
      category: 'behavioral',
      trigger: 'gate',
      via: 'heuristic',
      outcome,
      server_ttft_ms: 400,
    },
  };
}

function mockSupabase() {
  const update = jest.fn((row: Record<string, unknown>) => ({
    eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: SESSION_ID, ...row }, error: null }) }) }) }),
  }));
  const latencyQuery: { eq: jest.Mock; limit: jest.Mock } = {
    eq: jest.fn(() => latencyQuery),
    limit: jest.fn(async () => ({ data: [latencyRow(900), latencyRow(1400), latencyRow(2000, 'superseded')], error: null })),
  };
  const session = {
    id: SESSION_ID,
    user_id: 'user-1',
    status: 'active',
    started_at: new Date().toISOString(),
    metadata: { mode: 'general' },
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) =>
      table === 'copilot_sessions'
        ? { select: () => ({ eq: () => ({ single: async () => ({ data: session, error: null }) }) }), update }
        : { select: () => latencyQuery },
  });
  return { update, latencyQuery };
}

async function call(body: unknown) {
  const { POST } = await import('./route');
  const req = { headers: { get: () => null }, json: async () => body } as unknown as NextRequest;
  const res = (await POST(req)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true });
  const counter = { allowed: true, used: 0, limit: 30, remaining: 30 };
  getCopilotQuotaSnapshot.mockResolvedValue({ monthly: counter, daily: counter, perSession: counter });
});

describe('POST /api/copilot/sessions/stop (latency and stop reason)', () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  afterAll(() => logSpy.mockRestore());

  it('stores why the session ended and its latency summary, and logs it', async () => {
    const { update, latencyQuery } = mockSupabase();
    const { status } = await call({ sessionId: SESSION_ID, reason: 'tab_closed' });

    expect(status).toBe(200);
    expect(latencyQuery.eq).toHaveBeenCalledWith('payload->>kind', 'latency');
    const metadata = update.mock.calls[0][0].metadata as Record<string, unknown>;
    expect(metadata.stop_reason).toBe('tab_closed');
    expect(metadata.latency_summary).toMatchObject({
      turns: 3,
      outcomes: { answered: 2, superseded: 1, stopped: 0, error: 0 },
      stages: { speech_to_first_token: { count: 2, p50: 900, p95: 1400 } },
    });
    expect(logSpy.mock.calls.map(([line]) => JSON.parse(line as string))).toEqual([
      expect.objectContaining({ event: 'latency_summary', sessionId: SESSION_ID, reason: 'tab_closed', turns: 3 }),
    ]);
  });

  it('defaults the reason to the Stop button and rejects unknown reasons', async () => {
    const { update } = mockSupabase();
    await call({ sessionId: SESSION_ID });
    expect((update.mock.calls[0][0].metadata as Record<string, unknown>).stop_reason).toBe('user');
    expect((await call({ sessionId: SESSION_ID, reason: 'bored' })).status).toBe(400);
  });
});
