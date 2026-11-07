/** @jest-environment node */
import type { NextRequest } from 'next/server';

const afterCallbacks: Array<() => Promise<void>> = [];
jest.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => afterCallbacks.push(callback),
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/quota', () => ({ reserveQuota: jest.fn(), releaseQuota: jest.fn() }));
jest.mock('@/lib/notify', () => ({ notify: jest.fn() }));
jest.mock('@/lib/practice/practice', () => ({
  ...jest.requireActual('@/lib/practice/practice'),
  completeChat: jest.fn(),
}));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { reserveQuota, releaseQuota } = jest.requireMock('@/lib/quota') as { reserveQuota: jest.Mock; releaseQuota: jest.Mock };
const RESERVED_AT = new Date('2026-11-07T10:00:00Z');
const { notify } = jest.requireMock('@/lib/notify') as { notify: jest.Mock };
const { completeChat } = jest.requireMock('@/lib/practice/practice') as { completeChat: jest.Mock };

const DOC_ID = '0b5c8c4e-7d1f-4c8e-9a43-2f6d1a7e9b10';
const JOB = 'Staff Engineer at Acme. You will own payments reliability, mentor engineers and run on-call.';
const RESUME = 'Jane Doe\nStripe, Senior Engineer\n- Led the payments migration that cut latency by 40%';

type Doc = { id: string; user_id: string; filename: string; parsed_text: string | null };

function setup({
  user = 'user-1',
  doc = { id: DOC_ID, user_id: 'user-1', filename: 'cv.pdf', parsed_text: RESUME } as Doc | null,
  failCompletedSave = false,
} = {}) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: table === 'resume_documents' ? doc : null, error: null }),
        }),
      }),
    }),
  });
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];
  createAdminClient.mockReturnValue({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 'gen-1', ...row }, error: null }) }) };
      },
      update: (row: Record<string, unknown>) => {
        updates.push(row);
        const failed = failCompletedSave && row.status === 'completed';
        return { eq: async () => ({ error: failed ? { message: 'connection reset' } : null }) };
      },
    }),
  });
  return { updates, inserts };
}

async function call(body: unknown) {
  const { POST } = await import('./route');
  const req = { headers: { get: () => null }, json: async () => body } as unknown as NextRequest;
  const res = (await POST(req)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

async function runAfter() {
  while (afterCallbacks.length) await afterCallbacks.shift()?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  afterCallbacks.length = 0;
  process.env.OPENAI_API_KEY = 'test-openai';
  reserveQuota.mockResolvedValue({ ok: true, reservedAt: RESERVED_AT });
});

afterAll(() => {
  delete process.env.OPENAI_API_KEY;
});

describe('POST /api/resume/generate', () => {
  it('needs a signed-in user', async () => {
    setup({ user: '' });
    expect((await call({ documentId: DOC_ID, jobDescription: JOB })).status).toBe(401);
  });

  it('checks the job description, the résumé and the quota', async () => {
    setup();
    expect((await call({ documentId: DOC_ID, jobDescription: 'too short' })).status).toBe(400);

    setup({ doc: { id: DOC_ID, user_id: 'user-2', filename: 'x.pdf', parsed_text: RESUME } });
    expect(await call({ documentId: DOC_ID, jobDescription: JOB })).toMatchObject({ status: 404 });

    setup({ doc: { id: DOC_ID, user_id: 'user-1', filename: 'x.pdf', parsed_text: null } });
    expect(await call({ documentId: DOC_ID, jobDescription: JOB })).toMatchObject({ status: 422 });

    const { inserts } = setup();
    reserveQuota.mockResolvedValue({ ok: false, error: 'quota_exceeded', used: 10, limit: 10 });
    expect(await call({ documentId: DOC_ID, jobDescription: JOB })).toMatchObject({ status: 403, body: { error: 'quota_exceeded' } });
    reserveQuota.mockResolvedValue({ ok: false, error: 'quota_unavailable', used: 0, limit: 0 });
    expect(await call({ documentId: DOC_ID, jobDescription: JOB })).toMatchObject({ status: 503, body: { error: 'quota_unavailable' } });
    expect(inserts).toEqual([]);
  });

  it('says so when no model can be called', async () => {
    delete process.env.OPENAI_API_KEY;
    setup();
    expect(await call({ documentId: DOC_ID, jobDescription: JOB })).toMatchObject({ status: 503, body: { error: 'llm_unavailable' } });
  });

  it('takes the quota before answering, so it is counted even while the résumé is being written', async () => {
    const { inserts, updates } = setup();
    completeChat.mockResolvedValue(
      JSON.stringify({ target: 'Staff Engineer at Acme', summary: 'Leads with payments.', changes: ['Moved payments up'], keywords: ['payments'], resume: RESUME }),
    );

    const res = await call({ documentId: DOC_ID, jobDescription: JOB });
    expect(res.status).toBe(202);
    expect(reserveQuota).toHaveBeenCalledWith('user-1', 'resume_deep_reviews');
    expect(inserts[0]).toMatchObject({ user_id: 'user-1', document_id: DOC_ID, status: 'processing', job_description: JOB });
    expect(completeChat).not.toHaveBeenCalled();

    await runAfter();
    expect(completeChat.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o-mini' });
    expect(updates[0]).toMatchObject({ status: 'completed', output: { target: 'Staff Engineer at Acme', resume: RESUME } });
    expect(releaseQuota).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('user-1', expect.objectContaining({ type: 'ai_suggestion', url: '/resume' }));
  });

  it('marks a failed attempt and hands its quota back', async () => {
    const { updates } = setup();
    completeChat.mockRejectedValue(new Error('timeout'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await call({ documentId: DOC_ID, jobDescription: JOB })).status).toBe(202);
    await runAfter();
    expect(updates[0]).toMatchObject({ status: 'failed' });
    expect(releaseQuota).toHaveBeenCalledWith('user-1', 'resume_deep_reviews', RESERVED_AT);
    expect(notify).not.toHaveBeenCalled();
  });

  it('treats a résumé that could not be saved as failed: not counted, not announced', async () => {
    const { updates } = setup({ failCompletedSave: true });
    completeChat.mockResolvedValue(
      JSON.stringify({ target: 'Staff Engineer at Acme', summary: 'Leads with payments.', changes: ['Moved payments up'], keywords: ['payments'], resume: RESUME }),
    );
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await call({ documentId: DOC_ID, jobDescription: JOB })).status).toBe(202);
    await runAfter();
    expect(updates.map((row) => row.status)).toEqual(['completed', 'failed']);
    expect(releaseQuota).toHaveBeenCalledWith('user-1', 'resume_deep_reviews', RESERVED_AT);
    expect(notify).not.toHaveBeenCalled();
  });
});
