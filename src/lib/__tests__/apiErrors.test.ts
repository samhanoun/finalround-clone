/** @jest-environment node */
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));

import { jsonError } from '@/lib/api';

type Res = { status: number; body: Record<string, unknown> };

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('jsonError', () => {
  it('keeps validation details on client errors', () => {
    const res = jsonError(400, 'invalid_body', { fieldErrors: { name: ['Required'] } }) as unknown as Res;
    expect(res).toEqual({ status: 400, body: { error: 'invalid_body', extra: { fieldErrors: { name: ['Required'] } } } });
  });

  it('never sends database or runtime errors to the client, and logs them instead', () => {
    const pg = { message: 'relation "public.secret_table" does not exist', code: '42P01', details: null, hint: null };
    const res = jsonError(500, 'db_error', pg) as unknown as Res;
    expect(res).toEqual({ status: 500, body: { error: 'db_error' } });
    // A client-safe extra (a request id) still goes out with a server error.
    expect((jsonError(500, 'internal_error', { requestId: 'r1' }) as unknown as Res).body).toEqual({ error: 'internal_error', extra: { requestId: 'r1' } });
    expect(console.error).toHaveBeenCalledWith('[api] 500 db_error', pg);

    expect((jsonError(400, 'db_error', pg) as unknown as Res).body).toEqual({ error: 'db_error' });
    expect((jsonError(502, 'upstream', new Error('socket hang up')) as unknown as Res).body).toEqual({ error: 'upstream' });
  });
});
