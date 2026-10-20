import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as { rateLimit: jest.Mock };
const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };

const TURN = {
  speech_to_final: 400,
  final_to_gate: 20,
  gate_to_first_token: 680,
  first_token_to_done: 1900,
  speech_to_first_token: 1100,
  category: 'behavioral',
  trigger: 'gate',
  via: 'heuristic',
  outcome: 'answered',
  server_ttft_ms: 520,
};

function mockSupabase({ owner = 'user-1', user = { id: 'user-1' } as { id: string } | null } = {}) {
  const insert = jest.fn().mockResolvedValue({ error: null });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table: string) =>
      table === 'copilot_sessions'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1', user_id: owner }, error: null }) }) }) }
        : { insert },
  });
  return { insert };
}

async function call(body: unknown) {
  const { POST } = await import('./route');
  const req = { headers: { get: () => null }, json: async () => body } as unknown as NextRequest;
  const res = (await POST(req, { params: Promise.resolve({ id: 's1' }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true });
});

describe('POST /api/copilot/sessions/[id]/latency', () => {
  it('stores each turn as a latency system event', async () => {
    const { insert } = mockSupabase();
    expect(await call({ turns: [TURN, { ...TURN, outcome: 'superseded', gate_to_first_token: null }] })).toMatchObject({
      status: 201,
      body: { accepted: 2 },
    });
    expect(insert.mock.calls[0][0]).toEqual([
      { session_id: 's1', user_id: 'user-1', event_type: 'system', payload: { kind: 'latency', ...TURN } },
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'latency', outcome: 'superseded' }) }),
    ]);
  });

  it('only accepts the signed-in owner, with sane numbers', async () => {
    mockSupabase({ user: null });
    expect((await call({ turns: [TURN] })).status).toBe(401);

    mockSupabase({ owner: 'user-2' });
    expect((await call({ turns: [TURN] })).status).toBe(404);

    mockSupabase();
    expect((await call({ turns: [{ ...TURN, final_to_gate: -5 }] })).status).toBe(400);
    expect((await call({ turns: [{ ...TURN, outcome: 'great' }] })).status).toBe(400);
    expect((await call({ turns: [] })).status).toBe(400);
  });
});
