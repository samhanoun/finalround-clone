/**
 * @jest-environment node
 */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
  },
}));
jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/stripe', () => ({ getStripe: jest.fn(), isStripeConfigured: jest.fn() }));

const { env } = jest.requireMock('@/lib/env') as { env: Record<string, string | undefined> };
const { rateLimit } = jest.requireMock('@/lib/rateLimit') as { rateLimit: jest.Mock };
const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { getStripe, isStripeConfigured } = jest.requireMock('@/lib/stripe') as { getStripe: jest.Mock; isStripeConfigured: jest.Mock };

/** Rows by table; lookups match every eq() filter. */
function fakeAdmin(tables: Record<string, Array<Record<string, unknown>>>) {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  createAdminClient.mockReturnValue({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find((row) => filters.every(([c, v]) => row[c] === v)) ?? null,
          error: null,
        }),
        upsert,
      };
      return query;
    },
  });
  return { upsert };
}

function fakeStripe() {
  const sessionsCreate = jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/c/pay_123' });
  const customersCreate = jest.fn().mockResolvedValue({ id: 'cus_new', email: 'a@example.test' });
  getStripe.mockReturnValue({ checkout: { sessions: { create: sessionsCreate } }, customers: { create: customersCreate } });
  return { sessionsCreate, customersCreate };
}

async function call(body: unknown = { currency: 'eur', locale: 'fr' }) {
  const { POST } = await import('./route');
  const req = { json: async () => body, nextUrl: { origin: 'http://localhost:3000' } } as unknown as NextRequest;
  const res = await POST(req);
  return { res, json: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, { PRICE_ID_PRO_EUR: 'price_eur', PRICE_ID_PRO_USD: 'price_usd', NEXT_PUBLIC_APP_URL: 'https://app.example.test' });
  rateLimit.mockResolvedValue({ ok: true });
  isStripeConfigured.mockReturnValue(true);
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'a@example.test' } }, error: null }) },
  });
});

describe('POST /api/billing/checkout', () => {
  it('creates a subscription checkout with the server-side price for the chosen currency', async () => {
    fakeAdmin({});
    const { sessionsCreate, customersCreate } = fakeStripe();

    const { res, json } = await call({ currency: 'eur', locale: 'fr', price: 'price_attacker' });

    expect(res.status).toBe(200);
    expect(json).toEqual({ url: 'https://checkout.stripe.test/c/pay_123' });
    expect(customersCreate).toHaveBeenCalledWith(
      { email: 'a@example.test', metadata: { user_id: 'user-1' } },
      { idempotencyKey: 'apex-customer-user-1' },
    );
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_new',
        client_reference_id: 'user-1',
        line_items: [{ price: 'price_eur', quantity: 1 }],
        subscription_data: { metadata: { user_id: 'user-1' } },
        success_url: 'https://app.example.test/fr/settings?billing=success',
        cancel_url: 'https://app.example.test/fr/settings?billing=cancelled',
      }),
    );
  });

  it('reuses the customer already mapped to the user', async () => {
    fakeAdmin({ stripe_customers: [{ user_id: 'user-1', stripe_customer_id: 'cus_1' }] });
    const { sessionsCreate, customersCreate } = fakeStripe();
    await call({ currency: 'usd' });
    expect(customersCreate).not.toHaveBeenCalled();
    expect(sessionsCreate.mock.calls[0][0]).toMatchObject({ customer: 'cus_1', line_items: [{ price: 'price_usd', quantity: 1 }] });
  });

  it('refuses a second Pro subscription', async () => {
    fakeAdmin({ subscriptions: [{ id: 's1', user_id: 'user-1', plan_id: 'pro', status: 'active' }] });
    const { sessionsCreate } = fakeStripe();
    const { res, json } = await call();
    expect(res.status).toBe(409);
    expect(json.error).toBe('already_subscribed');
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('needs sign-in, a configured Stripe and a price', async () => {
    fakeAdmin({});
    fakeStripe();

    createClient.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
    expect((await call()).res.status).toBe(401);

    isStripeConfigured.mockReturnValueOnce(false);
    expect((await call()).json.error).toBe('billing_unavailable');

    delete env.PRICE_ID_PRO_EUR;
    expect((await call({ currency: 'eur' })).res.status).toBe(503);

    expect((await call({ currency: 'gbp' })).res.status).toBe(400);
  });
});
