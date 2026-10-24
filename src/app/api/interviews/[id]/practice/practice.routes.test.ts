import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/practice/practice', () => ({
  ...jest.requireActual('@/lib/practice/practice'),
  completeChat: jest.fn(),
}));

import { LLMUnavailableError } from '@/lib/llmRouter';

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { completeChat } = jest.requireMock('@/lib/practice/practice') as { completeChat: jest.Mock };

const SESSION_ID = '5e1d0000-0000-4000-8000-000000000001';
const QUESTION_ID = '5e1d0000-0000-4000-8000-0000000000a1';
const RESUME_ID = '5e1d0000-0000-4000-8000-0000000000b1';

type Op = 'select' | 'insert' | 'update';
type Call = { table: string; op: Op; payload?: unknown; head?: boolean };
type Handler = (call: Call) => unknown;

/** A chainable stand-in for the Supabase query builder: every filter returns the builder; awaiting it runs the handler. */
function mockSupabase(handlers: Record<string, Partial<Record<Op | 'count', Handler>>>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: 'select' };
    const run = () => {
      calls.push({ ...call });
      const handler = call.head ? handlers[table]?.count : handlers[table]?.[call.op];
      return handler ? handler(call) : { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      select: (_columns?: string, options?: { head?: boolean }) => {
        if (options?.head) call.head = true;
        return builder;
      },
      insert: (rows: unknown) => Object.assign(call, { op: 'insert', payload: rows }) && builder,
      update: (patch: unknown) => Object.assign(call, { op: 'update', payload: patch }) && builder,
      eq: () => builder,
      order: () => builder,
      maybeSingle: async () => run(),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from,
  });
  return calls;
}

function request(body: unknown) {
  return { headers: { get: () => null }, json: async () => body } as unknown as NextRequest;
}

async function callStart(body: unknown) {
  const { POST } = await import('./start/route');
  const res = (await POST(request(body), { params: Promise.resolve({ id: SESSION_ID }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

async function callAnswer(body: unknown) {
  const { POST } = await import('./answer/route');
  const res = (await POST(request(body), { params: Promise.resolve({ id: SESSION_ID }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

const QUESTIONS_REPLY = JSON.stringify({
  questions: [
    { text: 'Tell me about the payments migration you led.', type: 'behavioral', difficulty: 'medium' },
    { text: 'How did you decide what to cut when the deadline moved?', type: 'behavioral', difficulty: 'hard' },
  ],
});

beforeEach(() => jest.clearAllMocks());

describe('POST /api/interviews/[id]/practice/start', () => {
  function startHandlers(existing = 0) {
    return {
      interview_sessions: {
        select: () => ({ data: { id: SESSION_ID, user_id: 'user-1', meta: { source: 'test' } }, error: null }),
        update: () => ({ error: null }),
      },
      interview_questions: {
        count: () => ({ count: existing, error: null }),
        insert: (call: Call) => ({
          data: (call.payload as Array<Record<string, unknown>>).map((row, i) => ({ id: `q${i}`, ...row })),
          error: null,
        }),
      },
      resume_documents: {
        select: () => ({
          data: { id: RESUME_ID, user_id: 'user-1', filename: 'cv.pdf', parsed_text: 'Led the payments migration at Stripe.' },
          error: null,
        }),
      },
    };
  }

  it('writes the questions in order and records the setup on the session', async () => {
    const calls = mockSupabase(startHandlers());
    completeChat.mockResolvedValue(QUESTIONS_REPLY);

    const { status, body } = await callStart({
      role: 'Staff Engineer',
      company: 'Acme',
      type: 'behavioral',
      difficulty: 'medium',
      count: 3,
      resumeDocumentId: RESUME_ID,
      jobDescription: 'Own the payments platform.',
    });

    expect(status).toBe(201);
    expect(body.title).toBe('Staff Engineer at Acme');
    const insert = calls.find((c) => c.table === 'interview_questions' && c.op === 'insert');
    expect(insert?.payload).toEqual([
      expect.objectContaining({ order_index: 0, question_text: 'Tell me about the payments migration you led.', user_id: 'user-1' }),
      expect.objectContaining({ order_index: 1, difficulty: 'hard' }),
    ]);
    const update = calls.find((c) => c.table === 'interview_sessions' && c.op === 'update')?.payload as Record<string, unknown>;
    expect(update).toMatchObject({ title: 'Staff Engineer at Acme', status: 'in_progress' });
    const meta = update.meta as Record<string, Record<string, unknown>>;
    expect(meta.source).toBe('test');
    expect(meta.practice).toMatchObject({ role: 'Staff Engineer', hasResume: true, hasJob: true, count: 3 });
    expect(meta.practice.jobDescription).toBeUndefined();
    expect(meta.context_pack).toMatchObject({ role: 'Staff Engineer', resume: expect.stringContaining('payments migration') });
  });

  it('refuses to start twice', async () => {
    mockSupabase(startHandlers(3));
    expect(await callStart({ role: 'Engineer' })).toMatchObject({ status: 409, body: { error: 'already_started' } });
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('says so when no model is configured', async () => {
    mockSupabase(startHandlers());
    completeChat.mockRejectedValue(new LLMUnavailableError('OPENAI_API_KEY is not set'));
    expect(await callStart({ role: 'Engineer' })).toMatchObject({ status: 503, body: { error: 'llm_unavailable' } });
  });

  it('saves nothing when the model reply has no usable questions', async () => {
    const calls = mockSupabase(startHandlers());
    completeChat.mockResolvedValue('Sorry, I cannot.');
    expect(await callStart({ role: 'Engineer' })).toMatchObject({ status: 502, body: { error: 'questions_unavailable' } });
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });
});

describe('POST /api/interviews/[id]/practice/answer', () => {
  function answerHandlers(question: Record<string, unknown> | null = {
    id: QUESTION_ID,
    session_id: SESSION_ID,
    question_text: 'Why this team?',
    question_type: 'general',
    difficulty: 'easy',
  }) {
    return {
      interview_sessions: {
        select: () => ({ data: { id: SESSION_ID, meta: { practice: { role: 'Staff Engineer', company: 'Acme' } } }, error: null }),
      },
      interview_questions: {
        select: () => ({ data: question, error: null }),
        update: () => ({ error: null }),
      },
    };
  }

  it('saves the answer, then the feedback and a 0–100 score', async () => {
    const calls = mockSupabase(answerHandlers());
    completeChat.mockResolvedValue(
      '{"score":8,"verdict":"Strong","strengths":["specific"],"improvements":["shorter"],"stronger_answer":["impact"]}',
    );

    const { status, body } = await callAnswer({ questionId: QUESTION_ID, answer: 'Because of the payments work.' });

    expect(status).toBe(200);
    expect(body.feedback).toMatchObject({ score: 8, verdict: 'Strong' });
    const updates = calls.filter((c) => c.table === 'interview_questions' && c.op === 'update').map((c) => c.payload);
    expect(updates[0]).toMatchObject({ response_text: 'Because of the payments work.' });
    expect(updates[1]).toMatchObject({ response_score: 80, rubric: { feedback: expect.objectContaining({ score: 8 }) } });
  });

  it('keeps the answer when the feedback fails', async () => {
    const calls = mockSupabase(answerHandlers());
    completeChat.mockResolvedValue('not json');
    expect(await callAnswer({ questionId: QUESTION_ID, answer: 'My answer.' })).toMatchObject({
      status: 502,
      body: { error: 'feedback_unavailable' },
    });
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1);
  });

  it('only accepts a question from this interview', async () => {
    mockSupabase(answerHandlers(null));
    expect(await callAnswer({ questionId: QUESTION_ID, answer: 'x' })).toMatchObject({ status: 404, body: { error: 'question_not_found' } });
  });
});
