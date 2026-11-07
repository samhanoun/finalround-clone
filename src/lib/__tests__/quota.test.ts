/** @jest-environment node */
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

import { releaseQuota, reserveQuota } from '@/lib/quota';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

/** A usage counter behind check_quota / record_usage, with an optional other request landing in between. */
function counter({ used = 0, limit = 10, checkFails = false, recordFails = false, concurrent = 0 } = {}) {
  const state = { used, recorded: [] as number[] };
  createAdminClient.mockReturnValue({
    rpc: async (name: string, args: { p_amount?: number }) => {
      if (name === 'check_quota') {
        if (checkFails) return { data: null, error: { message: 'down' } };
        return { data: [{ allowed: state.used + 1 <= limit, used: state.used, limit_val: limit, remaining: Math.max(0, limit - state.used) }], error: null };
      }
      if (recordFails) return { error: { message: 'down' } };
      state.recorded.push(args.p_amount ?? 0);
      state.used += (args.p_amount ?? 0) + (args.p_amount && args.p_amount > 0 ? concurrent : 0);
      return { error: null };
    },
  });
  return state;
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('reserveQuota', () => {
  it('takes one unit when there is room', async () => {
    const state = counter({ used: 3 });
    expect(await reserveQuota('u', 'resume_deep_reviews')).toMatchObject({ ok: true });
    expect(state).toMatchObject({ used: 4, recorded: [1] });
  });

  it('refuses without touching the counter when the limit is reached', async () => {
    const state = counter({ used: 10 });
    expect(await reserveQuota('u', 'resume_deep_reviews')).toEqual({ ok: false, error: 'quota_exceeded', used: 10, limit: 10 });
    expect(state.recorded).toEqual([]);
  });

  it('hands the unit back when a parallel request took the last one first', async () => {
    const state = counter({ used: 9, concurrent: 1 });
    expect(await reserveQuota('u', 'resume_deep_reviews')).toEqual({ ok: false, error: 'quota_exceeded', used: 10, limit: 10 });
    expect(state).toMatchObject({ used: 10, recorded: [1, -1] });
  });

  it('refuses the work when the quota cannot be read or counted', async () => {
    counter({ checkFails: true });
    expect(await reserveQuota('u', 'resume_deep_reviews')).toMatchObject({ ok: false, error: 'quota_unavailable' });
    counter({ recordFails: true });
    expect(await reserveQuota('u', 'resume_deep_reviews')).toMatchObject({ ok: false, error: 'quota_unavailable' });
  });
});

describe('releaseQuota', () => {
  it('hands a unit back in the same month only', async () => {
    const state = counter({ used: 4 });
    await releaseQuota('u', 'resume_deep_reviews', new Date('2026-11-07T10:00:00Z'), new Date('2026-11-07T10:01:30Z'));
    expect(state).toMatchObject({ used: 3, recorded: [-1] });
    await releaseQuota('u', 'resume_deep_reviews', new Date('2026-11-30T23:59:30Z'), new Date('2026-12-01T00:01:00Z'));
    expect(state.recorded).toEqual([-1]);
  });
});
