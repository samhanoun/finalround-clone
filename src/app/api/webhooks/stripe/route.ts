import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { getStripe, isStripeConfigured } from '@/lib/stripe';

export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const sig = (await headers()).get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET!);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: `Invalid signature: ${msg}` }, { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (e) {
    // IMPORTANT: return 200 so Stripe doesn't retry forever if we have transient DB errors.
    // We still log so we can fix.
    console.error('[stripe webhook] handler error', e);
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'customer.created':
    case 'customer.updated':
      return upsertCustomer(event.data.object as Stripe.Customer);

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return upsertSubscription(event.data.object as Stripe.Subscription);

    default:
      // ignore
      return;
  }
}

async function upsertCustomer(customer: Stripe.Customer) {
  // We only persist a mapping if Stripe customer has user_id metadata.
  const userId = customer.metadata?.user_id;
  if (!userId) return;

  const admin = createAdminClient();
  await admin.from('stripe_customers').upsert(
    {
      user_id: userId,
      stripe_customer_id: customer.id,
      email: customer.email ?? null,
    },
    { onConflict: 'stripe_customer_id' }
  );
}

async function upsertSubscription(sub: Stripe.Subscription) {
  const admin = createAdminClient();

  // Find owner user_id via stripe_customers mapping.
  const { data: customerRow } = await admin
    .from('stripe_customers')
    .select('user_id')
    .eq('stripe_customer_id', String(sub.customer))
    .maybeSingle();

  const userId = customerRow?.user_id;
  if (!userId) {
    // We don't know who this belongs to yet (e.g., mapping not created).
    return;
  }

  const price = sub.items.data[0]?.price;
  const priceId = price?.id ?? null;

  // 1) Always sync raw Stripe subscription snapshot
  await admin.from('stripe_subscriptions').upsert(
    {
      user_id: userId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: String(sub.customer),
      stripe_price_id: priceId,
      status: sub.status,
      currency: (price?.currency ?? sub.currency ?? null) as string | null,
      current_period_start: sub.current_period_start
        ? new Date(sub.current_period_start * 1000).toISOString()
        : null,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      cancel_at_period_end: sub.cancel_at_period_end,
    },
    { onConflict: 'stripe_subscription_id' }
  );

  // 2) Map Stripe subscription -> app plan (Pro)
  // Only map known Pro price ids.
  const isProPrice =
    !!priceId && (priceId === env.PRICE_ID_PRO_EUR || priceId === env.PRICE_ID_PRO_USD);

  if (!isProPrice) return;

  const isActive = sub.status === 'active' || sub.status === 'trialing';

  if (isActive) {
    await admin.from('subscriptions').upsert(
      {
        user_id: userId,
        plan_id: 'pro',
        status: 'active',
        current_period_start: sub.current_period_start
          ? new Date(sub.current_period_start * 1000).toISOString()
          : null,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      },
      { onConflict: 'user_id,plan_id' }
    );
  } else {
    // Mark any existing Pro row inactive; user falls back to Free by default.
    await admin
      .from('subscriptions')
      .update({
        status: 'canceled',
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      })
      .eq('user_id', userId)
      .eq('plan_id', 'pro');
  }
}
