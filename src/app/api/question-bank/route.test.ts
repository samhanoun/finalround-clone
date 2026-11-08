import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };

type Result = { data?: unknown; error?: { code?: string; message?: string } | null };

function mockSupabase(results: { table?: Result; rpc?: Result }) {
  const inserts: unknown[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = () => builder;
  builder.insert = (row: unknown) => {
    inserts.push(row);
    return builder;
  };
  builder.maybeSingle = async () => results.table ?? { data: null, error: null };
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(results.table ?? { data: [], error: null }).then(resolve);
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => builder,
    rpc: async () => results.rpc ?? { data: [], error: null },
  });
  return inserts;
}

function request(url: string, body?: unknown) {
  return { nextUrl: new URL(url), json: async () => body } as unknown as NextRequest;
}

async function call(method: 'GET' | 'POST', url: string, body?: unknown) {
  const route = await import('./route');
  const res = (await route[method](request(url, body))) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => jest.clearAllMocks());

describe('/api/question-bank', () => {
  it('lists companies with questions: yours and shared ones, merged by name', async () => {
    mockSupabase({
      table: { data: [{ company: 'Acme', company_key: 'acme' }, { company: 'Acme', company_key: 'acme' }], error: null },
      rpc: { data: [{ company: 'ACME', questions: 4 }, { company: 'Globex', questions: 2 }], error: null },
    });
    const { body } = await call('GET', 'http://localhost/api/question-bank');
    expect(body.companies).toEqual([
      { company: 'Acme', mine: 2, shared: 4 },
      { company: 'Globex', mine: 0, shared: 2 },
    ]);
  });

  it('adds a question you were asked, shared only if you say so', async () => {
    const inserts = mockSupabase({ table: { data: { id: 'q1' }, error: null } });
    const { status } = await call('POST', 'http://localhost/api/question-bank', {
      company: ' Acme ',
      question: 'How would you design a rate limiter?',
      type: 'technical',
    });
    expect(status).toBe(201);
    expect(inserts[0]).toMatchObject({
      user_id: 'user-1',
      company: 'Acme',
      question_text: 'How would you design a rate limiter?',
      source: 'reported',
      shared: false,
    });
  });

  it('says when the question is already in your bank', async () => {
    mockSupabase({ table: { data: null, error: { code: '23505', message: 'duplicate key' } } });
    const { status, body } = await call('POST', 'http://localhost/api/question-bank', { company: 'Acme', question: 'Why Acme, really?' });
    expect(status).toBe(409);
    expect(body.error).toBe('duplicate');
  });

  it('refuses questions too short to be one', async () => {
    mockSupabase({});
    const { status } = await call('POST', 'http://localhost/api/question-bank', { company: 'Acme', question: 'Why?' });
    expect(status).toBe(400);
  });
});
