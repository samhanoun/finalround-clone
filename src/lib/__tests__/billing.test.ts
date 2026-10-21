/**
 * @jest-environment node
 */
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/env', () => ({ env: { PRICE_ID_PRO_EUR: 'price_eur', PRICE_ID_PRO_USD: 'price_usd' } }));

import { getOrCreateStripeCustomer, proAccessUntil, proPriceId, recordCheckout, syncSubscription } from '@/lib/billing';

type Row = Record<string, unknown>;
type Call = { table: string; op: 'upsert' | 'update'; value: Row; options?: unknown; filters?: Array<[string, unknown]> };

/** Just enough of the Supabase client for billing.ts: lookups by eq, upserts and updates. */
function fakeAdmin(tables: Record<string, Row[]> = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      maybeSingle: async () => ({
        data: (tables[table] ?? []).find((row) => filters.every(([column, value]) => row[column] === value)) ?? null,
        error: null,
      }),
      upsert: async (value: Row, options?: unknown) => {
        calls.push({ table, op: 'upsert', value, options });
        return { error: null };
      },
      update: (value: Row) => {
        const updateFilters: Array<[string, unknown]> = [];
        const chain = {
          eq: (column: string, v: unknown) => {
            updateFilters.push([column, v]);
            return chain;
          },
          then: (resolve: (result: { error: null }) => void) => {
            calls.push({ table, op: 'update', value, filters: updateFilters });
            resolve({ error: null });
          },
        };
        return chain;
      },
    };
    return query;
  };
  return { admin: { from } as unknown as SupabaseClient, calls };
}

function subscription(overrides: Partial<Record<string, unknown>> = {}, priceId = 'price_usd') {
  return {
    id: 'sub_1',
    customer: { id: 'cus_1', deleted: undefined, metadata: { user_id: 'user-1' }, email: 'a@example.test' },
    status: 'active',
    currency: 'usd',
    cancel_at_period_end: false,
    items: { data: [{ price: { id: priceId, currency: 'usd' }, current_period_start: 1_760_000_000, current_period_end: 1_762_592_000 }] },
    ...overrides,
  };
}

function fakeStripe(sub: unknown) {
  const retrieve = jest.fn().mockResolvedValue(sub);
  const create = jest.fn().mockResolvedValue({ id: 'cus_new', email: 'new@example.test' });
  return { stripe: { subscriptions: { retrieve }, customers: { create } } as unknown as Stripe, retrieve, create };
}

describe('proPriceId', () => {
  it('maps the currency to the server-side price', () => {
    expect(proPriceId('eur')).toBe('price_eur');
    expect(proPriceId('usd')).toBe('price_usd');
  });
});

describe('syncSubscription', () => {
  it('re-reads the subscription and grants Pro while it is active, with the period from the item', async () => {
    const { stripe, retrieve } = fakeStripe(subscription());
    const { admin, calls } = fakeAdmin({ stripe_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] });

    await syncSubscription(stripe, admin, 'sub_1');

    expect(retrieve).toHaveBeenCalledWith('sub_1', { expand: ['customer'] });
    expect(calls.find((c) => c.table === 'stripe_subscriptions')?.value).toMatchObject({
      user_id: 'user-1',
      stripe_subscription_id: 'sub_1',
      stripe_customer_id: 'cus_1',
      stripe_price_id: 'price_usd',
      status: 'active',
      current_period_start: new Date(1_760_000_000 * 1000).toISOString(),
      current_period_end: new Date(1_762_592_000 * 1000).toISOString(),
    });
    expect(calls.find((c) => c.table === 'subscriptions')).toMatchObject({
      op: 'upsert',
      value: { user_id: 'user-1', plan_id: 'pro', status: 'active' },
      options: { onConflict: 'user_id,plan_id' },
    });
  });

  it('keeps Pro for a short grace only while a renewal is past due', async () => {
    const start = 1_760_000_000;
    const { stripe } = fakeStripe(subscription({ status: 'past_due' }));
    const { admin, calls } = fakeAdmin({ stripe_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] });

    await syncSubscription(stripe, admin, 'sub_1');

    expect(calls.find((c) => c.table === 'subscriptions')?.value).toMatchObject({
      plan_id: 'pro',
      status: 'active',
      current_period_end: new Date((start + 7 * 24 * 60 * 60) * 1000).toISOString(),
    });
  });

  it('grants nothing for unpaid, incomplete or paused subscriptions', () => {
    const period = { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' };
    for (const status of ['unpaid', 'incomplete', 'incomplete_expired', 'paused', 'canceled'] as const) {
      expect(proAccessUntil(status, period)).toBeNull();
    }
    expect(proAccessUntil('active', period)).toEqual({ until: period.end });
    expect(proAccessUntil('past_due', { start: '2026-10-30T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' })).toEqual({
      until: '2026-11-01T00:00:00.000Z', // the period ends before the grace would
    });
  });

  it('ends Pro when the subscription is canceled', async () => {
    const { stripe } = fakeStripe(subscription({ status: 'canceled' }));
    const { admin, calls } = fakeAdmin({ stripe_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] });

    await syncSubscription(stripe, admin, 'sub_1');

    expect(calls.find((c) => c.table === 'subscriptions')).toMatchObject({
      op: 'update',
      value: { status: 'canceled' },
      filters: [
        ['user_id', 'user-1'],
        ['plan_id', 'pro'],
      ],
    });
  });

  it('records other prices but never grants Pro for them', async () => {
    const { stripe } = fakeStripe(subscription({}, 'price_someone_else'));
    const { admin, calls } = fakeAdmin({ stripe_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] });

    await syncSubscription(stripe, admin, 'sub_1');

    expect(calls.map((c) => c.table)).toEqual(['stripe_subscriptions']);
  });

  it('maps the customer from its metadata when the subscription event comes first', async () => {
    const { stripe } = fakeStripe(subscription());
    const { admin, calls } = fakeAdmin();

    await syncSubscription(stripe, admin, 'sub_1');

    expect(calls[0]).toMatchObject({ table: 'stripe_customers', op: 'upsert', value: { user_id: 'user-1', stripe_customer_id: 'cus_1' } });
    expect(calls.some((c) => c.table === 'subscriptions' && c.value.plan_id === 'pro')).toBe(true);
  });

  it('ignores subscriptions of customers the app did not create', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { stripe } = fakeStripe(subscription({ customer: { id: 'cus_other', metadata: {} } }));
    const { admin, calls } = fakeAdmin();

    await syncSubscription(stripe, admin, 'sub_1');

    expect(calls).toEqual([]);
    warn.mockRestore();
  });
});

describe('getOrCreateStripeCustomer', () => {
  it('reuses the mapped customer', async () => {
    const { stripe, create } = fakeStripe(null);
    const { admin } = fakeAdmin({ stripe_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] });
    await expect(getOrCreateStripeCustomer(stripe, admin, { id: 'user-1' })).resolves.toBe('cus_1');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates one tagged customer per user and records it', async () => {
    const { stripe, create } = fakeStripe(null);
    const { admin, calls } = fakeAdmin();
    await expect(getOrCreateStripeCustomer(stripe, admin, { id: 'user-2', email: 'new@example.test' })).resolves.toBe('cus_new');
    expect(create).toHaveBeenCalledWith(
      { email: 'new@example.test', metadata: { user_id: 'user-2' } },
      { idempotencyKey: 'apex-customer-user-2' },
    );
    expect(calls[0]).toMatchObject({ table: 'stripe_customers', value: { user_id: 'user-2', stripe_customer_id: 'cus_new' } });
  });
});

describe('recordCheckout', () => {
  it('maps the customer to the checkout user and syncs the new subscription', async () => {
    const { stripe, retrieve } = fakeStripe(subscription());
    const { admin, calls } = fakeAdmin({ stripe_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] });

    await recordCheckout(stripe, admin, {
      mode: 'subscription',
      client_reference_id: 'user-1',
      customer: 'cus_1',
      subscription: 'sub_1',
      customer_details: { email: 'a@example.test' },
    } as unknown as Stripe.Checkout.Session);

    expect(calls[0]).toMatchObject({ table: 'stripe_customers', value: { user_id: 'user-1', stripe_customer_id: 'cus_1' } });
    expect(retrieve).toHaveBeenCalledWith('sub_1', { expand: ['customer'] });
  });

  it('ignores one-off payments', async () => {
    const { stripe, retrieve } = fakeStripe(null);
    const { admin, calls } = fakeAdmin();
    await recordCheckout(stripe, admin, { mode: 'payment' } as Stripe.Checkout.Session);
    expect(calls).toEqual([]);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
