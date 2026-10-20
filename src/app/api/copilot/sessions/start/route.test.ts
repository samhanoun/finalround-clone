import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/copilot', () => ({ getCopilotQuotaSnapshot: jest.fn() }));

const { rateLimit } = jest.requireMock('@/lib/rateLimit') as { rateLimit: jest.Mock };
const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { getCopilotQuotaSnapshot } = jest.requireMock('@/lib/copilot') as { getCopilotQuotaSnapshot: jest.Mock };

const RESUME_ID = '0b5c8c4e-7d1f-4c8e-9a43-2f6d1a7e9b10';

type ResumeRow = { id: string; user_id: string; filename: string | null; parsed_text: string | null };

function mockSupabase(resume: ResumeRow | null = { id: RESUME_ID, user_id: 'user-1', filename: 'cv.pdf', parsed_text: 'Led the payments migration at Stripe.' }) {
  const inserted: Array<Record<string, unknown>> = [];
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => {
      if (table === 'resume_documents') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: resume, error: null }) }) }) };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'session-1', ...row }, error: null }) }) };
        },
      };
    },
  });
  return inserted;
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

describe('POST /api/copilot/sessions/start with interview context', () => {
  it('builds the context pack from the résumé, job description, company and role', async () => {
    const inserted = mockSupabase();
    const { status } = await call({
      title: 'Acme onsite',
      metadata: { mode: 'general' },
      resumeDocumentId: RESUME_ID,
      jobDescription: 'Requirements:\n- 5+ years of TypeScript',
      company: 'Acme',
      role: 'Senior Engineer',
    });

    expect(status).toBe(201);
    const metadata = inserted[0].metadata as Record<string, unknown>;
    expect(metadata.mode).toBe('general');
    expect(metadata.context_pack).toMatchObject({
      version: 1,
      company: 'Acme',
      role: 'Senior Engineer',
      resume: 'Led the payments migration at Stripe.',
      resume_filename: 'cv.pdf',
      job: 'Requirements:\n- 5+ years of TypeScript',
    });
  });

  it('ignores a context pack sent by the client', async () => {
    const inserted = mockSupabase();
    await call({ metadata: { mode: 'general', context_pack: { resume: 'I was CEO of Google.' } } });
    expect((inserted[0].metadata as Record<string, unknown>).context_pack).toBeUndefined();
  });

  it('refuses someone else\'s résumé or one that was never parsed', async () => {
    mockSupabase({ id: RESUME_ID, user_id: 'user-2', filename: 'x.pdf', parsed_text: 'x' });
    expect(await call({ resumeDocumentId: RESUME_ID })).toMatchObject({ status: 404, body: { error: 'resume_not_found' } });

    mockSupabase({ id: RESUME_ID, user_id: 'user-1', filename: 'x.pdf', parsed_text: null });
    expect(await call({ resumeDocumentId: RESUME_ID })).toMatchObject({ status: 422, body: { error: 'resume_not_parsed' } });
  });

  it('still starts a session with no context', async () => {
    const inserted = mockSupabase();
    expect((await call({})).status).toBe(201);
    expect((inserted[0].metadata as Record<string, unknown>).context_pack).toBeUndefined();
  });
});
