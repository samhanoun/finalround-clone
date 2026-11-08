jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

import { POST } from './route';

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

type Row = Record<string, unknown>;

function mockUserClient({ user = { id: 'user-1' } as { id: string } | null, insertError = null as { message: string } | null } = {}) {
  const inserts: Array<{ table: string; row: Row }> = [];
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => ({
      insert: (row: Row) => {
        inserts.push({ table, row });
        return { select: () => ({ single: async () => (insertError ? { data: null, error: insertError } : { data: { id: 'share-1', ...row }, error: null }) }) };
      },
    }),
  });
  return inserts;
}

async function post(body: unknown) {
  const res = (await POST({ json: async () => body } as unknown as Request)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/social/shares', () => {
  it('records a badge share once, and awards no badge for it', async () => {
    const inserts = mockUserClient();
    const res = await post({ share_type: 'badge', platform: 'linkedin', content_id: 'badge-1', content_title: 'I earned the "Applied" badge' });
    expect(res).toMatchObject({ status: 200, body: { share: { id: 'share-1', share_type: 'badge' } } });
    expect(inserts).toEqual([
      {
        table: 'social_shares',
        row: { user_id: 'user-1', share_type: 'badge', platform: 'linkedin', content_id: 'badge-1', content_title: 'I earned the "Applied" badge', metadata: {} },
      },
    ]);
    // The old "Social Sharer" award (stored as referral_signup) is gone: badges come from milestones only.
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('takes referral shares (migration 0033)', async () => {
    const inserts = mockUserClient();
    expect((await post({ share_type: 'referral', platform: 'twitter', content_id: 'code-1' })).status).toBe(200);
    expect(inserts[0].row).toMatchObject({ share_type: 'referral', platform: 'twitter', content_title: null });
  });

  it('refuses a type or platform the table would reject, before writing', async () => {
    const inserts = mockUserClient();
    expect(await post({ share_type: 'gossip', platform: 'linkedin' })).toEqual({ status: 400, body: { error: 'invalid_body' } });
    expect(await post({ share_type: 'badge', platform: 'myspace' })).toEqual({ status: 400, body: { error: 'invalid_body' } });
    expect(await post(null)).toEqual({ status: 400, body: { error: 'invalid_body' } });
    expect(inserts).toEqual([]);
  });

  it('says so when the share could not be recorded', async () => {
    mockUserClient({ insertError: { message: 'new row violates check constraint "social_shares_share_type_check"' } });
    expect(await post({ share_type: 'referral', platform: 'linkedin' })).toEqual({ status: 500, body: { error: 'share_not_recorded' } });
    expect(console.error).toHaveBeenCalled();
  });

  it('needs a signed-in user', async () => {
    mockUserClient({ user: null });
    expect((await post({ share_type: 'badge', platform: 'email' })).status).toBe(401);
  });
});
