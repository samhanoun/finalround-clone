/**
 * @jest-environment node
 */

const headerValues = new Map<string, string>();
jest.mock('next/headers', () => ({ headers: async () => ({ get: (name: string) => headerValues.get(name) ?? null }) }));
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
  },
}));
jest.mock('@/lib/env', () => ({ env: { STRIPE_WEBHOOK_SECRET: 'whsec_test' } }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn(() => ({ admin: true })) }));
jest.mock('@/lib/stripe', () => ({ getStripe: jest.fn(), isStripeConfigured: jest.fn(() => true) }));
jest.mock('@/lib/billing', () => ({
  recordCheckout: jest.fn(),
  recordStripeCustomer: jest.fn(),
  syncSubscription: jest.fn(),
}));

const { getStripe } = jest.requireMock('@/lib/stripe') as { getStripe: jest.Mock };
const billing = jest.requireMock('@/lib/billing') as Record<'recordCheckout' | 'recordStripeCustomer' | 'syncSubscription', jest.Mock>;

const constructEvent = jest.fn();

async function deliver(event: unknown, signature: string | null = 't=1,v1=abc') {
  headerValues.clear();
  if (signature) headerValues.set('stripe-signature', signature);
  constructEvent.mockImplementation(() => {
    if (event instanceof Error) throw event;
    return event;
  });
  const { POST } = await import('./route');
  return POST(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  getStripe.mockReturnValue({ webhooks: { constructEvent } });
});

describe('POST /api/webhooks/stripe', () => {
  it('rejects deliveries without a valid signature', async () => {
    expect((await deliver({}, null)).status).toBe(400);
    expect((await deliver(new Error('No signatures found'))).status).toBe(400);
    expect(constructEvent).toHaveBeenCalledWith('{}', 't=1,v1=abc', 'whsec_test');
  });

  it('routes checkout, customer and subscription events', async () => {
    const session = { id: 'cs_1', mode: 'subscription' };
    expect((await deliver({ id: 'evt_1', type: 'checkout.session.completed', data: { object: session } })).status).toBe(200);
    expect(billing.recordCheckout).toHaveBeenCalledWith(expect.anything(), { admin: true }, session);

    await deliver({ id: 'evt_2', type: 'customer.created', data: { object: { id: 'cus_1' } } });
    expect(billing.recordStripeCustomer).toHaveBeenCalledWith({ admin: true }, { id: 'cus_1' });

    for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
      await deliver({ id: 'evt_3', type, data: { object: { id: 'sub_1' } } });
    }
    expect(billing.syncSubscription).toHaveBeenCalledTimes(3);
    expect(billing.syncSubscription).toHaveBeenCalledWith(expect.anything(), { admin: true }, 'sub_1');
  });

  it('acknowledges event types it does not handle', async () => {
    expect((await deliver({ id: 'evt_4', type: 'invoice.paid', data: { object: {} } })).status).toBe(200);
  });

  it('answers 500 when syncing fails, so Stripe retries the delivery', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    billing.syncSubscription.mockRejectedValueOnce(new Error('database down'));
    const res = await deliver({ id: 'evt_5', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } });
    expect(res.status).toBe(500);
    error.mockRestore();
  });
});
