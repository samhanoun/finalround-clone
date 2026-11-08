/**
 * @jest-environment node
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('@/lib/notify', () => ({ notify: jest.fn() }));

import { cancelBillingForDeletion } from '@/lib/billing';

/** The user's stripe_customers row, or a read error. */
function fakeAdmin(customer: string | null, error: { message: string } | null = null) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: async () => ({ data: customer ? { stripe_customer_id: customer } : null, error }),
  };
  return { admin: { from: jest.fn(() => query) } as unknown as SupabaseClient, filters };
}

/** Stripe's list is auto-paginating: an async iterable over every page, as the SDK's is. */
function fakeStripe(subs: Array<{ id: string; status: string }>, fail: { cancel?: string; unlink?: boolean } = {}) {
  const list = jest.fn(() =>
    (async function* () {
      yield* subs;
    })(),
  );
  const cancel = jest.fn(async (id: string) => {
    if (fail.cancel === id) throw new Error('Stripe is down');
    return { id, status: 'canceled' };
  });
  const update = jest.fn(async () => {
    if (fail.unlink) throw new Error('Stripe is down');
    return {};
  });
  return { stripe: { subscriptions: { list, cancel }, customers: { update } } as unknown as Stripe, list, cancel, update };
}

describe('cancelBillingForDeletion', () => {
  it('ends every subscription that can still charge, skips ended ones, and unlinks the customer', async () => {
    const { admin, filters } = fakeAdmin('cus_1');
    const { stripe, list, cancel, update } = fakeStripe([
      { id: 'sub_active', status: 'active' },
      { id: 'sub_trial', status: 'trialing' },
      { id: 'sub_retrying', status: 'past_due' },
      { id: 'sub_old', status: 'canceled' },
      { id: 'sub_never_paid', status: 'incomplete_expired' },
    ]);

    await expect(cancelBillingForDeletion(stripe, admin, 'user-1')).resolves.toEqual(['sub_active', 'sub_trial', 'sub_retrying']);

    expect(filters).toEqual([['user_id', 'user-1']]);
    expect(list).toHaveBeenCalledWith({ customer: 'cus_1', status: 'all', limit: 100 });
    expect(cancel.mock.calls.map(([id]) => id)).toEqual(['sub_active', 'sub_trial', 'sub_retrying']);
    // At once, not at the end of the period.
    expect(cancel).toHaveBeenCalledWith('sub_active', { cancellation_details: { comment: 'Account deleted in Apex Round' } });
    // Later events for the customer are ignored instead of failing against a deleted user.
    expect(update).toHaveBeenCalledWith('cus_1', { metadata: { user_id: '' } });
  });

  it('does nothing for an account that never had a Stripe customer', async () => {
    const { admin } = fakeAdmin(null);
    const { stripe, list, update } = fakeStripe([]);
    await expect(cancelBillingForDeletion(stripe, admin, 'user-1')).resolves.toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('throws when the customer can’t be read, before touching Stripe', async () => {
    const { admin } = fakeAdmin(null, { message: 'connection refused' });
    const { stripe, list } = fakeStripe([{ id: 'sub_active', status: 'active' }]);
    await expect(cancelBillingForDeletion(stripe, admin, 'user-1')).rejects.toThrow('connection refused');
    expect(list).not.toHaveBeenCalled();
  });

  it('throws when a subscription can’t be cancelled', async () => {
    const { admin } = fakeAdmin('cus_1');
    const { stripe, update } = fakeStripe([{ id: 'sub_active', status: 'active' }], { cancel: 'sub_active' });
    await expect(cancelBillingForDeletion(stripe, admin, 'user-1')).rejects.toThrow('Stripe is down');
    expect(update).not.toHaveBeenCalled();
  });

  it('still succeeds when only the unlinking fails: billing has stopped', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { admin } = fakeAdmin('cus_1');
    const { stripe } = fakeStripe([{ id: 'sub_active', status: 'active' }], { unlink: true });
    await expect(cancelBillingForDeletion(stripe, admin, 'user-1')).resolves.toEqual(['sub_active']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
