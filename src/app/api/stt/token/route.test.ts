import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/copilot', () => ({
  ...jest.requireActual('@/lib/copilot'),
  getCopilotQuotaSnapshot: jest.fn(),
}));
jest.mock('@/lib/env', () => ({ env: { DEEPGRAM_API_KEY: 'dg-secret-key' } }));

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as { rateLimit: jest.Mock };
const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { getCopilotQuotaSnapshot } = jest.requireMock('@/lib/copilot') as { getCopilotQuotaSnapshot: jest.Mock };
const { env } = jest.requireMock('@/lib/env') as { env: Record<string, string | undefined> };

const SESSION_ID = '7f1c2a9e-3b4d-4c5e-8f60-1a2b3c4d5e6f';

type SessionRow = { id: string; user_id: string; status: string; started_at: string; metadata: Record<string, unknown> | null };

function activeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    user_id: 'user-1',
    status: 'active',
    started_at: now,
    metadata: { last_heartbeat_at: now },
    ...overrides,
  };
}

function mockSupabase({ user = { id: 'user-1' }, session = activeSession() }: { user?: { id: string } | null; session?: SessionRow | null } = {}) {
  const single = jest.fn().mockResolvedValue({ data: session, error: session ? null : { code: 'PGRST116' } });
  createClient.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ single })) })) })),
  });
}

function quota(remaining: number) {
  const counter = { allowed: remaining > 0, used: 0, limit: remaining, remaining };
  return { monthly: counter, daily: counter, perSession: counter };
}

function request(body: unknown = { sessionId: SESSION_ID }) {
  return { headers: { get: () => null }, json: async () => body } as unknown as NextRequest;
}

async function call(body?: unknown) {
  const { POST } = await import('./route');
  const res = (await POST(request(body))) as unknown as { status: number; headers: Record<string, string>; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, headers: res.headers, body: await res.json() };
}

const fetchMock = jest.fn();

beforeAll(() => {
  if (typeof AbortSignal.timeout !== 'function') {
    (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () => new AbortController().signal;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true });
  getCopilotQuotaSnapshot.mockResolvedValue(quota(30));
  env.DEEPGRAM_API_KEY = 'dg-secret-key';
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'short-lived', expires_in: 30 }) });
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('POST /api/stt/token', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  afterAll(() => consoleSpy.mockRestore());

  it('mints a short-lived token and never returns the API key', async () => {
    mockSupabase();
    const { status, headers, body } = await call();

    expect(status).toBe(200);
    expect(body).toEqual({
      token: 'short-lived',
      expiresIn: 30,
      listenUrl: expect.stringContaining('wss://api.deepgram.com/v1/listen?model=nova-3'),
    });
    expect(JSON.stringify(body)).not.toContain('dg-secret-key');
    expect(headers['Cache-Control']).toBe('no-store');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepgram.com/v1/auth/grant');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Token dg-secret-key');
    expect(JSON.parse(init.body)).toEqual({ ttl_seconds: 30 });
  });

  it('rejects signed-out callers', async () => {
    mockSupabase({ user: null });
    expect((await call()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides sessions owned by someone else', async () => {
    mockSupabase({ session: activeSession({ user_id: 'user-2' }) });
    const { status, body } = await call();
    expect(status).toBe(404);
    expect(body.error).toBe('session_not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses stopped and heartbeat-expired sessions', async () => {
    mockSupabase({ session: activeSession({ status: 'stopped' }) });
    expect(await call()).toMatchObject({ status: 409, body: { error: 'session_not_active' } });

    const stale = new Date(Date.now() - 5 * 60_000).toISOString();
    mockSupabase({ session: activeSession({ started_at: stale, metadata: { last_heartbeat_at: stale } }) });
    expect(await call()).toMatchObject({ status: 409, body: { error: 'session_expired' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses once the session has used up the remaining minutes', async () => {
    const startedAt = new Date(Date.now() - 31 * 60_000).toISOString();
    mockSupabase({ session: activeSession({ started_at: startedAt }) });
    expect(await call()).toMatchObject({ status: 403, body: { error: 'quota_exceeded' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates the body', async () => {
    mockSupabase();
    expect((await call({ sessionId: 'not-a-uuid' })).status).toBe(400);
  });

  it('is rate limited', async () => {
    rateLimit.mockResolvedValueOnce({ ok: false, retryAfterMs: 1000 });
    expect((await call()).status).toBe(429);
  });

  it('reports a missing Deepgram key as not configured', async () => {
    mockSupabase();
    env.DEEPGRAM_API_KEY = undefined;
    expect(await call()).toMatchObject({ status: 503, body: { error: 'stt_not_configured' } });
  });

  it('maps Deepgram failures to 502 without leaking details', async () => {
    mockSupabase();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ err_msg: 'Invalid credentials' }) });
    expect(await call()).toMatchObject({ status: 502, body: { error: 'stt_token_failed' } });

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await call()).toMatchObject({ status: 502, body: { error: 'stt_token_failed' } });

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ unexpected: true }) });
    expect(await call()).toMatchObject({ status: 502, body: { error: 'stt_token_failed' } });
  });
});
