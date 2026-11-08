/** @jest-environment node */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/resumeParser', () => ({
  extractDocumentText: jest.fn(async () => ({ text: 'Jane Doe, senior engineer', data: {} })),
  extractResumeData: jest.fn(() => ({})),
}));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { extractDocumentText } = jest.requireMock('@/lib/resumeParser') as { extractDocumentText: jest.Mock };

const USER = '0e2e0000-0000-4000-8000-000000000001';

function setup() {
  const upload = jest.fn(async () => ({ error: null }));
  const buckets: string[] = [];
  const inserted: Array<Record<string, unknown>> = [];
  createAdminClient.mockReturnValue({
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);
        return { upload };
      },
    },
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 'doc-1', ...row }, error: null }) }) };
      },
    }),
  });
  return { upload, buckets, inserted };
}

function request(file: File | null, query = '?autoParse=true'): NextRequest {
  const form = new FormData();
  if (file) form.set('file', file);
  return {
    url: `http://localhost/api/resume/upload${query}`,
    headers: new Headers(),
    formData: async () => form,
  } as unknown as NextRequest;
}

async function upload(file: File | null, query?: string) {
  const { POST } = await import('./route');
  const res = (await POST(request(file, query))) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

const pdf = (name = 'cv.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

describe('POST /api/resume/upload', () => {
  it('refuses a file that is not a PDF or Word document before storing anything', async () => {
    const { upload: stored } = setup();
    const res = await upload(new File(['plain text'], 'cv.txt', { type: 'text/plain' }));
    expect(res).toEqual({ status: 415, body: { error: 'unsupported_type' } });
    expect(stored).not.toHaveBeenCalled();
  });

  it('refuses a file over 5 MB', async () => {
    const { upload: stored } = setup();
    const res = await upload(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'cv.pdf', { type: 'application/pdf' }));
    expect(res).toEqual({ status: 413, body: { error: 'file_too_large' } });
    expect(stored).not.toHaveBeenCalled();
  });

  it('refuses an empty upload', async () => {
    setup();
    expect((await upload(new File([], 'cv.pdf', { type: 'application/pdf' }))).status).toBe(400);
    expect((await upload(null)).status).toBe(400);
  });

  it("stores a PDF in the user's folder of the résumés bucket and reads its text", async () => {
    const { upload: stored, buckets, inserted } = setup();
    const res = await upload(pdf('Jane Doe.PDF'));
    expect(res.status).toBe(200);
    expect(buckets).toEqual(['resumes']);
    expect(stored).toHaveBeenCalledTimes(1);
    const [path] = stored.mock.calls[0] as unknown as [string];
    expect(path).toMatch(new RegExp(`^${USER}/\\d+-Jane Doe\\.PDF$`));
    expect(inserted[0]).toMatchObject({ user_id: USER, filename: 'Jane Doe.PDF', storage_bucket: 'resumes', storage_path: path, parse_status: 'completed' });
    // Read from the uploaded bytes, not downloaded again.
    expect(extractDocumentText).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'Jane Doe.PDF', 'application/pdf');
  });

  it('ignores ?bucket=: the file always goes to the résumés bucket', async () => {
    const { buckets, inserted } = setup();
    expect((await upload(pdf(), '?autoParse=true&bucket=other')).status).toBe(200);
    expect(buckets).toEqual(['resumes']);
    expect(inserted[0].storage_bucket).toBe('resumes');
  });

  it('uses a safe name in the storage path and keeps the original name for display', async () => {
    const { upload: stored, inserted } = setup();
    expect((await upload(pdf('../../Résumé (final)\\x.pdf'))).status).toBe(200);
    const [path] = stored.mock.calls[0] as unknown as [string];
    expect(path).toMatch(new RegExp(`^${USER}/\\d+-[A-Za-z0-9._ -]+$`));
    expect(path.split('/')).toHaveLength(2);
    expect(inserted[0].filename).toBe('../../Résumé (final)\\x.pdf');
  });

  it('keeps a name with two dots in a row', async () => {
    const { upload: stored, inserted } = setup();
    expect((await upload(pdf('John..Doe.pdf'))).status).toBe(200);
    const [path] = stored.mock.calls[0] as unknown as [string];
    expect(path).toMatch(new RegExp(`^${USER}/\\d+-John\\.\\.Doe\\.pdf$`));
    expect(inserted[0].filename).toBe('John..Doe.pdf');
  });

  it('skips reading the text with ?autoParse=false', async () => {
    extractDocumentText.mockClear();
    const { inserted } = setup();
    const res = await upload(pdf(), '?autoParse=false');
    expect(res.status).toBe(200);
    expect(extractDocumentText).not.toHaveBeenCalled();
    expect(inserted[0].parse_status).toBe('pending');
  });
});
