/**
 * @jest-environment node
 */
import type { NextRequest } from 'next/server';
import type { StreamChatOptions } from '@/lib/llmRouter';

const afterCallbacks: Array<() => unknown> = [];
jest.mock('next/server', () => ({
  after: (callback: () => unknown) => afterCallbacks.push(callback),
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
const mockStreamChat = jest.fn();
jest.mock('@/lib/llmRouter', () => ({
  ...jest.requireActual('@/lib/llmRouter'),
  streamChat: (options: StreamChatOptions) => mockStreamChat(options),
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/notify', () => ({ notify: jest.fn() }));
jest.mock('@/lib/env', () => ({ env: {}, llmProvider: () => 'auto' }));

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as { rateLimit: jest.Mock };
const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

/** A query builder that resolves to `result` however it is chained. */
function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'update', 'insert']) chain[method] = () => chain;
  chain.single = async () => result;
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function mockDatabase() {
  const reports: Array<Record<string, unknown>> = [];
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      if (table === 'interview_sessions') return query({ data: { id: 'iv-1', user_id: 'user-1' }, error: null });
      if (table === 'interview_questions') {
        return query({
          data: [{ id: 'q1', question_text: 'Tell me about a migration.', response_text: 'I led the payments migration.', rubric: {} }],
          error: null,
        });
      }
      return query({ data: null, error: null }); // llm_settings: the defaults
    },
  });
  createAdminClient.mockReturnValue({
    from: (table: string) => {
      const chain = query(table === 'jobs' ? { data: { id: 'job-1' }, error: null } : { data: { id: 'report-1' }, error: null });
      if (table === 'interview_reports') {
        chain.insert = (row: Record<string, unknown>) => {
          reports.push(row);
          return chain;
        };
      }
      return chain;
    },
  });
  return reports;
}

function modelReplies(text: string) {
  mockStreamChat.mockImplementationOnce(async function* () {
    yield text;
  });
}

async function call() {
  const { POST } = await import('./route');
  const req = { headers: { get: () => null }, json: async () => ({ mode: 'behavioral' }) } as unknown as NextRequest;
  const res = (await POST(req, { params: Promise.resolve({ id: 'iv-1' }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

const saved = process.env.OPENAI_API_KEY;
beforeEach(() => {
  jest.clearAllMocks();
  afterCallbacks.length = 0;
  rateLimit.mockResolvedValue({ ok: true });
  process.env.OPENAI_API_KEY = 'test-openai-key';
});
afterAll(() => {
  if (saved === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = saved;
});

describe('POST /api/interviews/[id]/report (practice report)', () => {
  it('keeps the practice rubric’s own four areas, only those the model scored, and no stock lines', async () => {
    const reports = mockDatabase();
    modelReplies(
      JSON.stringify({
        overall_score: 72,
        hiring_signal: 'lean_hire',
        summary: 'Specific and well paced.',
        strengths: ['Uses numbers'],
        weaknesses: [],
        next_steps: ['Rewrite two stories around your decisions'],
        rubric: {
          clarity: { score: 4, evidence: 'Short sentences', recommendation: 'Keep the opening short.' },
          structure: { score: 3, evidence: 'Result came early', recommendation: 'Situation, action, result.' },
        },
      }),
    );

    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.saved).toBe(true);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      session_id: 'iv-1',
      user_id: 'user-1',
      overall_score: 72,
      hiring_signal: 'lean_hire',
      strengths: ['Uses numbers'],
      weaknesses: [],
      next_steps: ['P1: Rewrite two stories around your decisions'],
      rubric: {
        clarity: { score: 4, evidence: 'Short sentences', recommendation: 'Keep the opening short.' },
        structure: { score: 3, evidence: 'Result came early', recommendation: 'Situation, action, result.' },
      },
    });
    expect(Object.keys(reports[0].rubric as object)).toEqual(['clarity', 'structure']);
  });

  it('saves nothing without a real overall score', async () => {
    const reports = mockDatabase();
    modelReplies('{"summary": "Could not score this one", "strengths": ["x"]}');

    const { status, body } = await call();
    expect(status).toBe(500);
    expect(body.error).toBe('report_generation_failed');
    expect(reports).toEqual([]);
  });
});
