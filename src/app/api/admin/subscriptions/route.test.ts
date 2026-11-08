/** @jest-environment node */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/adminAuth', () => ({
  MANAGE_ROLES: ['admin', 'super_admin'],
  requireAdmin: jest.fn(async () => ({ ok: true, userId: 'staff-1', role: 'admin' })),
}));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/stripe', () => ({ getStripe: jest.fn() }));
jest.mock('@/lib/billing', () => ({ syncSubscription: jest.fn() }));

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { getStripe } = jest.requireMock('@/lib/stripe') as { getStripe: jest.Mock };
const { syncSubscription } = jest.requireMock('@/lib/billing') as { syncSubscription: jest.Mock };

/** The stripe_subscriptions lookup: the app's own subscriptions only. */
function fakeAdmin(known: string[], error: { message: string } | null = null) {
  const writes: string[] = [];
  const admin = {
    from: () => {
      let id = '';
      const query = {
        select: () => query,
        eq: (_column: string, value: string) => {
          id = value;
          return query;
        },
        maybeSingle: async () => ({ data: known.includes(id) ? { stripe_subscription_id: id } : null, error }),
        update: () => {
          writes.push('update');
          return query;
        },
      };
      return query;
    },
  };
  createAdminClient.mockReturnValue(admin);
  return { admin, writes };
}

function fakeStripe() {
  const update = jest.fn(async (id: string, params: { cancel_at_period_end: boolean }) => ({ id, status: 'active', ...params }));
  const stripe = { subscriptions: { update } };
  getStripe.mockReturnValue(stripe);
  return { stripe, update };
}

async function patch(body: unknown) {
  const { PATCH } = await import('./route');
  const res = (await PATCH({ json: async () => body } as unknown as NextRequest)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  syncSubscription.mockResolvedValue(undefined);
});

describe('PATCH /api/admin/subscriptions', () => {
  it('cancels at the end of the period in Stripe, and copies Stripe’s state into the table', async () => {
    const { admin, writes } = fakeAdmin(['sub_1']);
    const { stripe, update } = fakeStripe();

    expect(await patch({ action: 'cancel', subscription_id: 'sub_1' })).toEqual({ status: 200, body: { success: true } });
    expect(update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    // The same sync the webhook runs; no hand-written status in the local row.
    expect(syncSubscription).toHaveBeenCalledWith(stripe, admin, 'sub_1');
    expect(writes).toEqual([]);
  });

  it('resumes by clearing the cancellation in Stripe', async () => {
    fakeAdmin(['sub_1']);
    const { update } = fakeStripe();
    expect((await patch({ action: 'resume', subscription_id: 'sub_1' })).status).toBe(200);
    expect(update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: false });
  });

  it('reports a change Stripe refused', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeAdmin(['sub_1']);
    const { update } = fakeStripe();
    update.mockRejectedValueOnce(new Error('No such subscription'));
    expect(await patch({ action: 'cancel', subscription_id: 'sub_1' })).toEqual({ status: 502, body: { error: 'stripe_failed' } });
    expect(syncSubscription).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('still succeeds when only the immediate copy fails: the webhook catches the row up', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakeAdmin(['sub_1']);
    fakeStripe();
    syncSubscription.mockRejectedValueOnce(new Error('database down'));
    expect((await patch({ action: 'cancel', subscription_id: 'sub_1' })).status).toBe(200);
    warn.mockRestore();
  });

  it('only touches the app’s own subscriptions', async () => {
    fakeAdmin(['sub_1']);
    const { update } = fakeStripe();
    expect(await patch({ action: 'cancel', subscription_id: 'sub_someone_elses' })).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(update).not.toHaveBeenCalled();
  });

  it('says billing is off when Stripe isn’t set up', async () => {
    fakeAdmin(['sub_1']);
    getStripe.mockReturnValue(null);
    expect(await patch({ action: 'cancel', subscription_id: 'sub_1' })).toEqual({ status: 503, body: { error: 'billing_unavailable' } });
  });

  it('has no refund or local-only plan change any more', async () => {
    fakeAdmin(['sub_1']);
    const { update } = fakeStripe();
    expect(await patch({ action: 'refund', subscription_id: 'sub_1' })).toEqual({ status: 400, body: { error: 'unknown_action' } });
    expect(await patch({ action: 'update_plan', subscription_id: 'sub_1', data: { price_id: 'price_2' } })).toEqual({
      status: 400,
      body: { error: 'unknown_action' },
    });
    expect((await patch({ action: 'cancel' })).body.error).toBe('invalid_body');
    expect(update).not.toHaveBeenCalled();
  });
});
