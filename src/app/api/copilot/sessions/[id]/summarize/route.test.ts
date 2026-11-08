/**
 * @jest-environment node
 */
import type { NextRequest } from 'next/server';
import type { StreamChatOptions } from '@/lib/llmRouter';
import { TASK_LIVE_REPORT } from '@/lib/copilot/sessionReport';
import { LIVE_RUBRIC_KEYS } from '@/lib/mockInterviewReport';

jest.mock('next/server', () => ({
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
jest.mock('@/lib/env', () => ({ env: {}, llmProvider: () => 'auto' }));

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as { rateLimit: jest.Mock };
const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };

const SESSION_ID = '22222222-2222-2222-2222-222222222222';

/** A session whose answer model was frozen at start (Settings → Answer model). */
function mockSupabase(metadata: Record<string, unknown> = { mode: 'general', models: { answer: 'claude-sonnet-5-5' } }) {
  const upserts: Array<Record<string, unknown>> = [];
  const upsert = jest.fn((row: Record<string, unknown>) => {
    upserts.push(row);
    return Object.assign(Promise.resolve({ error: null }), {
      select: () => ({ single: async () => ({ data: { id: `summary-${upserts.length}`, ...row }, error: null }) }),
    });
  });
  const events = [
    { event_type: 'transcript', payload: { speaker: 'interviewer', text: 'Tell me about a migration you led.' }, created_at: '2026-11-07T10:00:00Z' },
    { event_type: 'transcript', payload: { speaker: 'candidate', text: 'I led the payments migration at Stripe.' }, created_at: '2026-11-07T10:00:05Z' },
  ];
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-2' } }, error: null }) },
    from: (table: string) => {
      if (table === 'copilot_sessions') {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: { id: SESSION_ID, user_id: 'user-2', status: 'stopped', metadata }, error: null }) }),
          }),
        };
      }
      if (table === 'copilot_events') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ returns: async () => ({ data: events, error: null }) }) }) }) }) };
      }
      if (table === 'copilot_summaries') return { upsert };
      throw new Error(`Unexpected table: ${table}`);
    },
  });
  return { upsert, upserts };
}

function modelReplies(text: string) {
  mockStreamChat.mockImplementationOnce(async function* () {
    yield text;
  });
}

async function call() {
  const { POST } = await import('./route');
  const req = { headers: new Headers({ 'x-request-id': 'req-1' }) } as unknown as NextRequest;
  const res = (await POST(req, { params: Promise.resolve({ id: SESSION_ID }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  jest.clearAllMocks();
  rateLimit.mockResolvedValue({ ok: true });
  delete process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
});

afterAll(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('POST /api/copilot/sessions/[id]/summarize', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  afterAll(() => consoleSpy.mockRestore());

  it('writes the report with the session’s own answer model, here Anthropic, and saves it', async () => {
    const { upserts } = mockSupabase();
    modelReplies(
      JSON.stringify({
        overall_score: 76,
        hiring_signal: 'lean_hire',
        summary: 'Concrete migration story with numbers.',
        strengths: ['Specific results'],
        weaknesses: [],
        next_steps: ['Name one trade-off per answer'],
        rubric: { communication: { score: 4, evidence: 'Clear', recommendation: 'Shorter' }, ownership: { score: 5, evidence: 'I led', recommendation: '' } },
      }),
    );

    const { status, body } = await call();
    expect(status).toBe(200);

    const options = mockStreamChat.mock.calls[0][0] as StreamChatOptions;
    expect(options.model).toBe('claude-sonnet-5-5');
    expect(options.system[0]).toContain(TASK_LIVE_REPORT);
    expect(options.messages[0].content).toContain('[candidate] I led the payments migration at Stripe.');
    expect(options.messages[0].content).toContain(LIVE_RUBRIC_KEYS.join(', '));

    const report = body.report as { overall_score: number; strengths: string[]; weaknesses: string[]; rubric: Record<string, { score: number | null }> };
    expect(report.overall_score).toBe(76);
    // No stock lines, and the six live areas with the unscored ones not captured.
    expect(report.strengths).toEqual(['Specific results']);
    expect(report.weaknesses).toEqual([]);
    expect(Object.keys(report.rubric)).toEqual([...LIVE_RUBRIC_KEYS]);
    expect(report.rubric.ownership.score).toBe(5);
    expect(report.rubric.role_fit.score).toBeNull();

    expect(upserts.map((row) => row.summary_type)).toEqual(['final', 'mock_interview_report']);
    expect(upserts[0]).toMatchObject({ session_id: SESSION_ID, user_id: 'user-2', content: 'Concrete migration story with numbers.' });
  });

  it('uses OpenAI when the session’s answer model is an OpenAI one', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    mockSupabase({ mode: 'coding', models: { answer: 'gpt-4o' } });
    modelReplies('{"overall_score": 64, "hiring_signal": "lean_no_hire"}');
    expect((await call()).status).toBe(200);
    expect(mockStreamChat.mock.calls[0][0].model).toBe('gpt-4o');
  });

  it('saves nothing and says so when the model call fails', async () => {
    const { upsert } = mockSupabase();
    mockStreamChat.mockImplementationOnce(() => {
      throw new Error('overloaded');
    });

    expect(await call()).toEqual({ status: 502, body: { error: 'summary_failed', extra: { requestId: 'req-1' } } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('saves nothing when the reply has no real report, rather than a stand-in', async () => {
    const { upsert } = mockSupabase();
    modelReplies('I could not evaluate this interview.');
    expect((await call()).status).toBe(502);

    modelReplies('{"summary": "No score", "strengths": ["x"]}');
    expect((await call()).body).toMatchObject({ error: 'summary_failed' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('is unavailable, without calling a model or saving, when no provider has a key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { upsert } = mockSupabase();

    expect(await call()).toEqual({ status: 503, body: { error: 'summary_unavailable' } });
    expect(mockStreamChat).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
