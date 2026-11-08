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

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

const DOC_ID = '0b5c8c4e-7d1f-4c8e-9a43-2f6d1a7e9b10';
const USER = '0e2e0000-0000-4000-8000-000000000001';
const OTHER = '9f9f0000-0000-4000-8000-000000000002';

type Doc = { id: string; storage_bucket: string | null; storage_path: string | null };

function setup({
  user = USER as string | null,
  doc = { id: DOC_ID, storage_bucket: 'resumes', storage_path: `${USER}/1-cv.pdf` } as Doc | null,
  storageError = null as string | null,
} = {}) {
  const remove = jest.fn(async () => ({ error: storageError ? { message: storageError } : null }));
  const buckets: string[] = [];
  const lookups: Array<[string, unknown]> = [];
  const deletes: Array<[string, unknown]> = [];
  createAdminClient.mockReturnValue({
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);
        return { remove };
      },
    },
  });
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) },
    from: () => ({
      select: () => {
        const query = {
          eq: (column: string, value: unknown) => {
            lookups.push([column, value]);
            return query;
          },
          maybeSingle: async () => ({ data: doc, error: null }),
        };
        return query;
      },
      delete: () => {
        const query = {
          eq: (column: string, value: unknown) => {
            deletes.push([column, value]);
            return query;
          },
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        };
        return query;
      },
    }),
  });
  return { remove, buckets, lookups, deletes };
}

async function remove(id = DOC_ID) {
  const { DELETE } = await import('./route');
  const res = (await DELETE({} as NextRequest, { params: Promise.resolve({ id }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

describe('DELETE /api/resume/documents/[id]', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));

  it('needs a signed-in user', async () => {
    setup({ user: null });
    expect((await remove()).status).toBe(401);
  });

  it("doesn't touch a document that isn't the user's", async () => {
    const { remove: removed, deletes } = setup({ doc: null });
    expect((await remove()).status).toBe(404);
    expect(removed).not.toHaveBeenCalled();
    expect(deletes).toEqual([]);
  });

  it('removes the file and the row, scoped to the user', async () => {
    const { remove: removed, buckets, lookups, deletes } = setup();
    expect(await remove()).toEqual({ status: 200, body: { ok: true } });
    expect(lookups).toEqual([
      ['id', DOC_ID],
      ['user_id', USER],
    ]);
    expect(buckets).toEqual(['resumes']);
    expect(removed).toHaveBeenCalledWith([`${USER}/1-cv.pdf`]);
    expect(deletes).toEqual([
      ['id', DOC_ID],
      ['user_id', USER],
    ]);
  });

  it("never removes another user's file, even when the row points at it, and still deletes the row", async () => {
    for (const doc of [
      { id: DOC_ID, storage_bucket: 'resumes', storage_path: `${OTHER}/1-cv.pdf` },
      { id: DOC_ID, storage_bucket: 'resumes', storage_path: `${USER}/../${OTHER}/1-cv.pdf` },
      { id: DOC_ID, storage_bucket: 'avatars', storage_path: `${USER}/1-cv.pdf` },
    ]) {
      const { remove: removed, deletes } = setup({ doc });
      expect((await remove()).status).toBe(200);
      expect(removed).not.toHaveBeenCalled();
      expect(deletes).toHaveLength(2);
    }
  });

  it('still deletes the document when storage fails to remove the file', async () => {
    const { deletes } = setup({ storageError: 'not found' });
    expect((await remove()).status).toBe(200);
    expect(deletes).toHaveLength(2);
  });

  it('answers 404 for an id that is not a uuid', async () => {
    setup();
    expect((await remove('not-a-uuid')).status).toBe(404);
  });
});
