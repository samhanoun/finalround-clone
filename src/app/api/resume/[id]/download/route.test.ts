/** @jest-environment node */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

const USER = '0e2e0000-0000-4000-8000-000000000001';
const OTHER = '9f9f0000-0000-4000-8000-000000000002';

function setup(row: { storage_bucket: string | null; storage_path: string | null } | null) {
  const createSignedUrl = jest.fn(async (path: string) => ({ data: { signedUrl: `https://storage.example.test/${path}?sig=1` }, error: null }));
  const buckets: string[] = [];
  createAdminClient.mockReturnValue({
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);
        return { createSignedUrl };
      },
    },
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => (row ? { data: { id: 'doc-1', ...row }, error: null } : { data: null, error: { code: 'PGRST116' } }),
      };
      return query;
    },
  });
  return { createSignedUrl, buckets };
}

async function download() {
  const { GET } = await import('./route');
  const res = (await GET({} as NextRequest, { params: Promise.resolve({ id: 'doc-1' }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

describe('GET /api/resume/[id]/download', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));

  it("signs the user's own file", async () => {
    const { createSignedUrl, buckets } = setup({ storage_bucket: 'resumes', storage_path: `${USER}/1-cv.pdf` });
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.body.url).toContain(`${USER}/1-cv.pdf`);
    expect(buckets).toEqual(['resumes']);
    expect(createSignedUrl).toHaveBeenCalledWith(`${USER}/1-cv.pdf`, 60);
  });

  it("refuses a row that points at another user's file, without signing anything", async () => {
    const { createSignedUrl } = setup({ storage_bucket: 'resumes', storage_path: `${OTHER}/1-cv.pdf` });
    expect(await download()).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses another bucket and parent-folder tricks', async () => {
    for (const row of [
      { storage_bucket: 'avatars', storage_path: `${USER}/1-cv.pdf` },
      { storage_bucket: 'resumes', storage_path: `${USER}/../${OTHER}/1-cv.pdf` },
      { storage_bucket: 'resumes', storage_path: null },
    ]) {
      const { createSignedUrl } = setup(row);
      expect((await download()).status).toBe(404);
      expect(createSignedUrl).not.toHaveBeenCalled();
    }
  });

  it("answers 404 for a document that isn't the user's", async () => {
    const { createSignedUrl } = setup(null);
    expect((await download()).status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
