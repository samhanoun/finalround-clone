jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

import { copilotOk, copilotRateLimited, sessionExpiredResponse } from '@/lib/copilotApiResponse';

describe('copilotApiResponse contract', () => {
  it('returns both compatibility top-level fields and wrapped data payload', async () => {
    const response = copilotOk({ accepted: 2, rejected: 1 }, 201);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { accepted: 2, rejected: 1 },
      accepted: 2,
      rejected: 1,
    });
  });

  it('returns stable rate limit error code', async () => {
    const response = copilotRateLimited();
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' });
  });

  it('returns consistent session expired shape for clients', async () => {
    const response = sessionExpiredResponse({ id: 'sess-1' }, '2026-02-18T00:00:00.000Z');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'session_expired',
      code: 'session_expired',
      state: 'expired',
      expired_reason: 'heartbeat_timeout',
      session: {
        id: 'sess-1',
        status: 'expired',
        stopped_at: '2026-02-18T00:00:00.000Z',
      },
    });
  });
});
