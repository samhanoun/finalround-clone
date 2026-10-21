import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Pro subscriptions through Stripe (build plan Step 10). Stripe is the source
 * of truth; these helpers copy its state into `stripe_customers`,
 * `stripe_subscriptions` and the app's `subscriptions` (which drives quotas).
 * All writes use the service-role client.
 */

export type BillingCurrency = 'eur' | 'usd';

export function proPriceId(currency: BillingCurrency): string | null {
  const id = currency === 'eur' ? env.PRICE_ID_PRO_EUR : env.PRICE_ID_PRO_USD;
  return id || null;
}

function isProPrice(priceId: string | null | undefined): boolean {
  return !!priceId && (priceId === env.PRICE_ID_PRO_EUR || priceId === env.PRICE_ID_PRO_USD);
}

const toIso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);

/** Since API version 2025-03-31.basil the billing period lives on the subscription item. */
export function subscriptionPeriod(sub: Stripe.Subscription): { start: string | null; end: string | null } {
  const item = sub.items.data[0];
  return { start: toIso(item?.current_period_start), end: toIso(item?.current_period_end) };
}

/** How long a failed renewal keeps Pro while Stripe retries the payment. */
export const PAST_DUE_GRACE_DAYS = 7;

/**
 * Whether a subscription grants Pro, and until when. Active and trialing:
 * the current period. Past due: a short grace from the start of the unpaid
 * period, whatever the account's retry settings. Anything else: no access.
 */
export function proAccessUntil(
  status: Stripe.Subscription.Status,
  period: { start: string | null; end: string | null },
): { until: string | null } | null {
  if (status === 'active' || status === 'trialing') return { until: period.end };
  if (status === 'past_due' && period.start) {
    const grace = new Date(Date.parse(period.start) + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    return { until: period.end && period.end < grace ? period.end : grace };
  }
  return null;
}

export async function findStripeCustomerId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from('stripe_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  return data?.stripe_customer_id ?? null;
}

/** One Stripe customer per user, tagged with the user id and recorded before checkout. */
export async function getOrCreateStripeCustomer(
  stripe: Stripe,
  admin: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<string> {
  const existing = await findStripeCustomerId(admin, user.id);
  if (existing) return existing;

  const customer = await stripe.customers.create(
    { email: user.email ?? undefined, metadata: { user_id: user.id } },
    // Two quick clicks create one customer, not two.
    { idempotencyKey: `apex-customer-${user.id}` },
  );
  const { error } = await admin
    .from('stripe_customers')
    .upsert({ user_id: user.id, stripe_customer_id: customer.id, email: customer.email ?? null }, { onConflict: 'user_id' });
  if (error) throw new Error(`Could not save the Stripe customer: ${error.message}`);
  return customer.id;
}

/** Records a customer that carries our user id (created by getOrCreateStripeCustomer). */
export async function recordStripeCustomer(admin: SupabaseClient, customer: Stripe.Customer): Promise<void> {
  const userId = customer.metadata?.user_id;
  if (!userId) return;
  await admin
    .from('stripe_customers')
    .upsert({ user_id: userId, stripe_customer_id: customer.id, email: customer.email ?? null }, { onConflict: 'user_id' });
}

/** Checkout finished: make sure the customer is mapped, then sync its subscription. */
export async function recordCheckout(stripe: Stripe, admin: SupabaseClient, session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== 'subscription') return;
  const userId = session.client_reference_id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  if (userId && customerId) {
    await admin
      .from('stripe_customers')
      .upsert({ user_id: userId, stripe_customer_id: customerId, email: session.customer_details?.email ?? null }, { onConflict: 'user_id' });
  }
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (subscriptionId) await syncSubscription(stripe, admin, subscriptionId);
}

/**
 * Copies a subscription's current state from Stripe. Events can arrive out of
 * order, so the event payload is only a trigger: the subscription is re-read.
 */
export async function syncSubscription(stripe: Stripe, admin: SupabaseClient, subscriptionId: string): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['customer'] });
  const customer = sub.customer;
  const customerId = typeof customer === 'string' ? customer : customer.id;

  const { data: customerRow } = await admin
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  let userId: string | undefined = customerRow?.user_id;
  // The subscription event can beat checkout.session.completed; our customers carry the user id.
  if (!userId && typeof customer !== 'string' && !customer.deleted && customer.metadata?.user_id) {
    await recordStripeCustomer(admin, customer);
    userId = customer.metadata.user_id;
  }
  if (!userId) {
    console.warn('[billing] subscription for a customer not created by the app; ignored', { subscriptionId, customerId });
    return;
  }

  const price = sub.items.data[0]?.price;
  const period = subscriptionPeriod(sub);

  const snapshot = await admin.from('stripe_subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      stripe_price_id: price?.id ?? null,
      status: sub.status,
      currency: price?.currency ?? sub.currency ?? null,
      current_period_start: period.start,
      current_period_end: period.end,
      cancel_at_period_end: sub.cancel_at_period_end,
    },
    { onConflict: 'stripe_subscription_id' },
  );
  if (snapshot.error) throw new Error(`Could not save the subscription: ${snapshot.error.message}`);

  if (!isProPrice(price?.id)) return;

  const access = proAccessUntil(sub.status, period);
  const plan = access
    ? await admin.from('subscriptions').upsert(
        {
          user_id: userId,
          plan_id: 'pro',
          status: 'active',
          current_period_start: period.start,
          // get_user_plan ignores rows past this date, so access lapses on time even without another event.
          current_period_end: access.until,
        },
        { onConflict: 'user_id,plan_id' },
      )
    : await admin
        .from('subscriptions')
        .update({ status: 'canceled', current_period_end: period.end })
        .eq('user_id', userId)
        .eq('plan_id', 'pro');
  if (plan.error) throw new Error(`Could not update the plan: ${plan.error.message}`);
}
