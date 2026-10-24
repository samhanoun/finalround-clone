import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CLAIM_WINDOW_DAYS,
  claimReferral,
  markReferralConverted,
  normalizeReferralCode,
  withinClaimWindow,
} from '@/lib/referrals';

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

describe('withinClaimWindow', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it('accepts accounts created in the last week only', () => {
    expect(withinClaimWindow(daysAgo(0.1), now)).toBe(true);
    expect(withinClaimWindow(daysAgo(CLAIM_WINDOW_DAYS - 0.5), now)).toBe(true);
    expect(withinClaimWindow(daysAgo(CLAIM_WINDOW_DAYS + 0.5), now)).toBe(false);
    expect(withinClaimWindow(undefined, now)).toBe(false);
    expect(withinClaimWindow('not a date', now)).toBe(false);
  });
});

describe('claimReferral', () => {
  it('records the sign-up for the code owner, and touches no counters', async () => {
    const { admin, calls } = mockAdmin((call) =>
      call.table === 'referral_codes' ? { data: { user_id: 'referrer' } } : { data: null, error: null },
    );

    await expect(claimReferral(admin, 'ABCD1234', 'new-user')).resolves.toBe('claimed');
    expect(calls.find((c) => c.op === 'insert')?.payload).toMatchObject({
      referrer_id: 'referrer',
      referee_id: 'new-user',
      referral_code: 'ABCD1234',
      status: 'signed_up',
    });
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('treats the unique-referee violation as already claimed, even for a concurrent claim', async () => {
    const { admin } = mockAdmin((call) =>
      call.table === 'referral_codes'
        ? { data: { user_id: 'referrer' } }
        : { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    );
    await expect(claimReferral(admin, 'ABCD1234', 'me')).resolves.toBe('already_claimed');
  });

  it('refuses your own code and unknown codes, and reports other database errors', async () => {
    const own = mockAdmin((call) => (call.table === 'referral_codes' ? { data: { user_id: 'me' } } : undefined));
    await expect(claimReferral(own.admin, 'ABCD1234', 'me')).resolves.toBe('own_code');
    expect(own.calls.some((c) => c.op === 'insert')).toBe(false);

    const unknown = mockAdmin(() => ({ data: null }));
    await expect(claimReferral(unknown.admin, 'ABCD1234', 'me')).resolves.toBe('invalid_code');

    const broken = mockAdmin((call) =>
      call.table === 'referral_codes' ? { data: { user_id: 'referrer' } } : { error: { code: '42501', message: 'denied' } },
    );
    await expect(claimReferral(broken.admin, 'ABCD1234', 'me')).rejects.toThrow('denied');
  });
});

describe('markReferralConverted', () => {
  it('converts a signed-up referral once', async () => {
    const { admin, calls } = mockAdmin(() => ({ data: { id: 'tracking-1' } }));

    await expect(markReferralConverted(admin, 'payer')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: 'referral_tracking',
      op: 'update',
      payload: expect.objectContaining({ status: 'converted' }),
      filters: [
        ['referee_id', 'payer'],
        ['status', 'signed_up'],
      ],
    });
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
