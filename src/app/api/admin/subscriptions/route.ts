import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { syncSubscription } from '@/lib/billing';
import { getStripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { MANAGE_ROLES, requireAdmin } from '@/lib/adminAuth';

/** Every admin PATCH has one shape: the action, the id of what it acts on, and the action's own fields under `data`. */
const PatchSchema = z.object({
  action: z.string().min(1),
  subscription_id: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status') || '';
    const offset = (page - 1) * limit;

    let query = supabase
      .from('stripe_subscriptions')
      .select(`
        *,
        stripe_customers!inner(email, user_id)
      `, { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: subscriptions, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching subscriptions:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const subs = subscriptions?.map(sub => ({
      id: sub.stripe_subscription_id,
      user_id: sub.stripe_customers?.user_id,
      email: sub.stripe_customers?.email,
      status: sub.status,
      price_id: sub.stripe_price_id,
      currency: sub.currency,
      current_period_start: sub.current_period_start,
      current_period_end: sub.current_period_end,
      cancel_at_period_end: sub.cancel_at_period_end,
      created_at: sub.created_at
    })) || [];

    return NextResponse.json({
      subscriptions: subs,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('Admin subscriptions API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH: cancel (at the end of the period) or resume a subscription. Stripe is the source of truth, so the
 * change is made there; its state is then copied into stripe_subscriptions by the same sync the webhook runs.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(MANAGE_ROLES);
  if (!auth.ok) return auth.response;

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid_body', parsed.error.flatten());
  const { action, subscription_id: subscriptionId } = parsed.data;
  if (action !== 'cancel' && action !== 'resume') return jsonError(400, 'unknown_action');

  const stripe = getStripe();
  if (!stripe) return jsonError(503, 'billing_unavailable');

  try {
    const supabase = createAdminClient();

    // Only the app's own subscriptions (the ones this console lists), not anything else on the Stripe account.
    const { data: row, error } = await supabase
      .from('stripe_subscriptions')
      .select('stripe_subscription_id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return jsonError(404, 'not_found');

    try {
      await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: action === 'cancel' });
    } catch (e) {
      console.error('[admin subscriptions] Stripe refused the change', { action, subscriptionId, error: e instanceof Error ? e.message : e });
      return jsonError(502, 'stripe_failed');
    }

    // The webhook syncs the row too; doing it now lets the list show the change straight away. If this
    // copy fails, Stripe has still changed and the webhook catches the row up.
    try {
      await syncSubscription(stripe, supabase, subscriptionId);
    } catch (e) {
      console.warn('[admin subscriptions] changed in Stripe; the webhook will update the row', { subscriptionId, error: e instanceof Error ? e.message : e });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[admin subscriptions] action failed', { action, subscriptionId, error: (error as { message?: string })?.message ?? error });
    return jsonError(500, 'action_failed');
  }
}
