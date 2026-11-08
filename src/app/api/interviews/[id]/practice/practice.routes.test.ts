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

type Op = 'select' | 'insert' | 'update' | 'upsert';
type Call = { table: string; op: Op; payload?: unknown; head?: boolean };
type Handler = (call: Call) => unknown;

/** A chainable stand-in for the Supabase query builder: every filter returns the builder; awaiting it runs the handler. */
function mockSupabase(
  handlers: Record<string, Partial<Record<Op | 'count', Handler>>>,
  rpc: (name: string, args: unknown) => unknown = () => ({ data: [], error: null }),
) {
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
      upsert: (rows: unknown) => Object.assign(call, { op: 'upsert', payload: rows }) && builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => run(),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from,
    rpc: async (name: string, args: unknown) => rpc(name, args),
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
      company_questions: {
        select: () => ({ data: bank, error: null }),
        upsert: () => ({ error: null }),
      },
    };
  }
  let bank: Array<Record<string, unknown>> = [];
  beforeEach(() => {
    bank = [];
  });

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
    // The new questions join the user's private bank for Acme.
    const saved = calls.find((c) => c.table === 'company_questions' && c.op === 'upsert')?.payload;
    expect(saved).toEqual([
      expect.objectContaining({ company: 'Acme', source: 'practice', question_text: 'Tell me about the payments migration you led.' }),
      expect.objectContaining({ company: 'Acme', source: 'practice', question_type: 'behavioral' }),
    ]);
  });

  it("starts with the company's bank questions and has the model write only the rest", async () => {
    bank = [
      { id: 'b1', company: 'Acme', question_text: 'Why do you want to work at Acme?', question_type: 'general', source: 'reported', shared: false },
    ];
    const calls = mockSupabase(startHandlers(), () => ({
      data: [
        {
          question_text: 'Describe a time you disagreed with your manager.',
          question_type: 'behavioral',
          reports: 3,
          last_reported_at: '2026-10-01T00:00:00Z',
        },
      ],
      error: null,
    }));
    completeChat.mockResolvedValue(QUESTIONS_REPLY);

    const { status, body } = await callStart({ role: 'Engineer', company: 'Acme', count: 3, fromBank: true });

    expect(status).toBe(201);
    const request = completeChat.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain('Number of questions: 1');
    expect(request.messages[0].content).toContain('- Why do you want to work at Acme?');
    const insert = calls.find((c) => c.table === 'interview_questions' && c.op === 'insert')?.payload as Array<Record<string, unknown>>;
    expect(insert.map((row) => row.question_text)).toEqual([
      'Why do you want to work at Acme?',
      'Describe a time you disagreed with your manager.',
      'Tell me about the payments migration you led.',
    ]);
    expect((body.setup as Record<string, unknown>).fromBank).toBe(true);
    // Only the question the model wrote is new to the bank.
    expect(calls.find((c) => c.op === 'upsert')?.payload).toEqual([
      expect.objectContaining({ question_text: 'Tell me about the payments migration you led.' }),
    ]);
  });

  it('needs no model when the bank has enough questions', async () => {
    bank = ['Why Acme?', 'Tell me about a failure.', 'What would you build first?'].map((text, i) => ({
      id: `b${i}`,
      company: 'Acme',
      question_text: text,
      question_type: 'general',
      source: 'reported',
      shared: false,
    }));
    mockSupabase(startHandlers());
    const { status, body } = await callStart({ role: 'Engineer', company: 'Acme', count: 3, fromBank: true });
    expect(status).toBe(201);
    expect(completeChat).not.toHaveBeenCalled();
    expect(body.questions).toHaveLength(3);
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
  const QUESTION = {
    id: QUESTION_ID,
    session_id: SESSION_ID,
    question_text: 'Why this team?',
    question_type: 'general',
    difficulty: 'easy',
    order_index: 2,
    rubric: {},
  };

  function answerHandlers(question: Record<string, unknown> | null = QUESTION, practice: Record<string, unknown> = {}) {
    return {
      interview_sessions: {
        select: () => ({
          data: { id: SESSION_ID, meta: { practice: { role: 'Staff Engineer', company: 'Acme', ...practice } } },
          error: null,
        }),
      },
      interview_questions: {
        select: () => ({ data: question, error: null }),
        update: () => ({ error: null }),
        insert: (call: Call) => ({ data: { id: 'follow-1', ...(call.payload as Record<string, unknown>) }, error: null }),
      },
    };
  }

  const FEEDBACK = '"score":6,"verdict":"Vague","strengths":["honest"],"improvements":["numbers"],"stronger_answer":["impact"]';

  it('saves the follow-up right after the question and links the two', async () => {
    const calls = mockSupabase(answerHandlers());
    completeChat.mockResolvedValue(`{${FEEDBACK},"follow_up":"Which of those payments numbers did you own?"}`);

    const { status, body } = await callAnswer({ questionId: QUESTION_ID, answer: 'We improved payments a lot.' });

    expect(status).toBe(200);
    expect((completeChat.mock.calls[0][0] as { system: string[] }).system[0]).toContain('"follow_up"');
    const insert = calls.find((c) => c.table === 'interview_questions' && c.op === 'insert')?.payload;
    expect(insert).toMatchObject({
      question_text: 'Which of those payments numbers did you own?',
      order_index: 2,
      user_id: 'user-1',
      rubric: { follow_up_of: QUESTION_ID },
    });
    const updates = calls.filter((c) => c.table === 'interview_questions' && c.op === 'update').map((c) => c.payload);
    expect(updates[1]).toMatchObject({ rubric: { follow_up_id: 'follow-1', feedback: expect.objectContaining({ score: 6 }) } });
    expect(body.followUp).toMatchObject({ id: 'follow-1' });
  });

  it('asks no follow-up on a follow-up, on a second answer, or when they are off', async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ ...QUESTION, rubric: { follow_up_of: 'parent' } }, {}],
      [{ ...QUESTION, rubric: { follow_up_id: 'follow-1' } }, {}],
      [QUESTION, { followUps: false }],
    ];
    for (const [question, practice] of cases) {
      jest.clearAllMocks();
      const calls = mockSupabase(answerHandlers(question, practice));
      completeChat.mockResolvedValue(`{${FEEDBACK},"follow_up":"Another question?"}`);
      const { body } = await callAnswer({ questionId: QUESTION_ID, answer: 'Answer.' });
      expect((completeChat.mock.calls[0][0] as { system: string[] }).system[0]).not.toContain('"follow_up"');
      expect(calls.some((c) => c.op === 'insert')).toBe(false);
      expect(body.followUp).toBeNull();
    }
  });

  it('keeps what the question already records when the feedback is saved', async () => {
    const calls = mockSupabase(answerHandlers({ ...QUESTION, rubric: { follow_up_of: 'parent' } }));
    completeChat.mockResolvedValue(`{${FEEDBACK}}`);
    await callAnswer({ questionId: QUESTION_ID, answer: 'Answer.' });
    const updates = calls.filter((c) => c.op === 'update').map((c) => c.payload);
    expect(updates[1]).toMatchObject({ rubric: { follow_up_of: 'parent', feedback: expect.any(Object) } });
  });

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

describe('GET /api/interviews/[id]/export', () => {
  async function callExport() {
    const { GET } = await import('../export/route');
    const res = (await GET(request(undefined), { params: Promise.resolve({ id: SESSION_ID }) })) as unknown as {
      status: number;
      headers: Record<string, string>;
      json: () => Promise<Record<string, unknown>>;
    };
    return { status: res.status, headers: res.headers, body: await res.json() };
  }

  it('downloads the interview with its questions, answers, feedback and report', async () => {
    mockSupabase({
      interview_sessions: { select: () => ({ data: { id: SESSION_ID, title: 'Staff Engineer at Acme', created_at: '2026-11-07T10:00:00Z' }, error: null }) },
      interview_questions: {
        select: () => ({
          data: [{ question_text: 'Tell me about the payments migration you led.', response_text: 'I led it.', rubric: { feedback: { score: 7 } } }],
          error: null,
        }),
      },
      interview_reports: { select: () => ({ data: [{ overall_score: 72, hiring_signal: 'lean_hire' }], error: null }) },
      interview_session_messages: { select: () => ({ data: [], error: null }) },
    });

    const { status, headers, body } = await callExport();

    expect(status).toBe(200);
    expect(headers['content-disposition']).toBe('attachment; filename="practice-interview-2026-11-07.json"');
    expect(body).toMatchObject({
      session: { id: SESSION_ID },
      questions: [{ question_text: 'Tell me about the payments migration you led.', response_text: 'I led it.', rubric: { feedback: { score: 7 } } }],
      report: { overall_score: 72 },
      messages: [],
    });
  });

  it('answers 404 for an interview that is not yours', async () => {
    mockSupabase({ interview_sessions: { select: () => ({ data: null, error: null }) } });
    expect(await callExport()).toMatchObject({ status: 404, body: { error: 'not_found' } });
  });
});
