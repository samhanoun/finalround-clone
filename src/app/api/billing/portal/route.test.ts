/** @jest-environment node */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }) },
}));
jest.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.example.test' } }));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) } })),
}));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn(() => ({})) }));
jest.mock('@/lib/stripe', () => ({ getStripe: jest.fn() }));
jest.mock('@/lib/billing', () => ({ findStripeCustomerId: jest.fn() }));
jest.mock('@/lib/quota', () => ({ getUserPlan: jest.fn() }));

const { getStripe } = jest.requireMock('@/lib/stripe') as { getStripe: jest.Mock };
const { findStripeCustomerId } = jest.requireMock('@/lib/billing') as { findStripeCustomerId: jest.Mock };
const { getUserPlan } = jest.requireMock('@/lib/quota') as { getUserPlan: jest.Mock };

async function post(body: unknown = { locale: 'es' }) {
  const { POST } = await import('./route');
  const req = { json: async () => body, nextUrl: { origin: 'http://localhost' } } as unknown as NextRequest;
  const res = (await POST(req)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

const create = jest.fn(async () => ({ url: 'https://billing.stripe.test/session' }));

beforeEach(() => {
  jest.clearAllMocks();
  getStripe.mockReturnValue({ billingPortal: { sessions: { create } } });
});

describe('POST /api/billing/portal', () => {
  it('opens the portal for the user’s own customer, returning to their language', async () => {
    findStripeCustomerId.mockResolvedValue('cus_1');
    expect(await post()).toEqual({ status: 200, body: { url: 'https://billing.stripe.test/session' } });
    expect(create).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://app.example.test/es/settings' });
  });

  it('tells a plan given without payment apart from a free account', async () => {
    findStripeCustomerId.mockResolvedValue(null);
    getUserPlan.mockResolvedValue({ plan_id: 'tester' });
    expect(await post()).toMatchObject({ status: 404, body: { error: 'plan_without_billing' } });

    getUserPlan.mockResolvedValue({ plan_id: 'free' });
    expect(await post()).toMatchObject({ status: 404, body: { error: 'no_billing_account' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('says billing is unavailable without Stripe', async () => {
    getStripe.mockReturnValue(null);
    expect(await post()).toMatchObject({ status: 503, body: { error: 'billing_unavailable' } });
  });
});
