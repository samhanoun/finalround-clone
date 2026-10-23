import type { SupabaseClient } from '@supabase/supabase-js';
import { claimReferral, markReferralConverted, normalizeReferralCode } from '@/lib/referrals';

type Call = { table: string; op: 'select' | 'insert' | 'update'; payload?: unknown; filters: Array<[string, unknown]> };

/** A chainable stand-in for the service-role client; `reply` decides what each awaited query returns. */
function mockAdmin(reply: (call: Call) => unknown) {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      const run = () => {
        calls.push(call);
        return reply(call) ?? { data: null, error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: (payload: unknown) => Object.assign(call, { op: 'insert', payload }) && builder,
        update: (payload: unknown) => Object.assign(call, { op: 'update', payload }) && builder,
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => run(),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return builder;
    },
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

describe('normalizeReferralCode', () => {
  it('accepts short alphanumeric codes, upper-cased', () => {
    expect(normalizeReferralCode(' 25b78738 ')).toBe('25B78738');
    expect(normalizeReferralCode('ab')).toBeNull();
    expect(normalizeReferralCode('x; drop')).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});

describe('claimReferral', () => {
  it('records the sign-up for the code owner and counts it', async () => {
    const { admin, calls } = mockAdmin((call) => {
      if (call.table === 'referral_codes' && call.op === 'select') return { data: { user_id: 'referrer', referral_count: 2 } };
      if (call.table === 'referral_tracking' && call.op === 'select') return { data: [] };
      return { data: null, error: null };
    });

    await expect(claimReferral(admin, 'ABCD1234', 'new-user')).resolves.toBe('claimed');
    expect(calls.find((c) => c.op === 'insert')?.payload).toMatchObject({
      referrer_id: 'referrer',
      referee_id: 'new-user',
      referral_code: 'ABCD1234',
      status: 'signed_up',
    });
    expect(calls.find((c) => c.table === 'referral_codes' && c.op === 'update')).toMatchObject({
      payload: { referral_count: 3 },
      filters: [['user_id', 'referrer']],
    });
  });

  it('refuses your own code, unknown codes and a second claim', async () => {
    const own = mockAdmin((call) => (call.table === 'referral_codes' ? { data: { user_id: 'me', referral_count: 0 } } : undefined));
    await expect(claimReferral(own.admin, 'ABCD1234', 'me')).resolves.toBe('own_code');

    const unknown = mockAdmin(() => ({ data: null }));
    await expect(claimReferral(unknown.admin, 'ABCD1234', 'me')).resolves.toBe('invalid_code');

    const twice = mockAdmin((call) =>
      call.table === 'referral_codes' ? { data: { user_id: 'referrer', referral_count: 0 } } : { data: [{ id: 'earlier' }] },
    );
    await expect(claimReferral(twice.admin, 'ABCD1234', 'me')).resolves.toBe('already_claimed');
    expect(twice.calls.some((c) => c.op !== 'select')).toBe(false);
  });
});

describe('markReferralConverted', () => {
  it('converts a signed-up referral once and counts it for the referrer', async () => {
    const { admin, calls } = mockAdmin((call) => {
      if (call.table === 'referral_tracking') return { data: { referral_code: 'ABCD1234', referrer_id: 'referrer' } };
      if (call.table === 'referral_codes' && call.op === 'select') return { data: { conversion_count: 4 } };
      return { data: null, error: null };
    });

    await expect(markReferralConverted(admin, 'payer')).resolves.toBe(true);
    expect(calls[0]).toMatchObject({
      op: 'update',
      payload: expect.objectContaining({ status: 'converted' }),
      filters: [
        ['referee_id', 'payer'],
        ['status', 'signed_up'],
      ],
    });
    expect(calls.find((c) => c.table === 'referral_codes' && c.op === 'update')?.payload).toEqual({ conversion_count: 5 });
  });

  it('does nothing for an account without a pending referral, and never throws', async () => {
    const none = mockAdmin(() => ({ data: null }));
    await expect(markReferralConverted(none.admin, 'payer')).resolves.toBe(false);

    const broken = mockAdmin(() => {
      throw new Error('db down');
    });
    await expect(markReferralConverted(broken.admin, 'payer')).resolves.toBe(false);
  });
});
