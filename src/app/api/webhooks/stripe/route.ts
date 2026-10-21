import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { recordCheckout, recordStripeCustomer, syncSubscription } from '@/lib/billing';

/**
 * Stripe webhook. Subscribe the endpoint to: checkout.session.completed,
 * customer.created, customer.updated, customer.subscription.created,
 * customer.subscription.updated, customer.subscription.deleted.
 * Create it on API version 2026-09-30.endive, the version src/lib/stripe.ts pins.
 */
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
    await handleEvent(stripe, event);
  } catch (e) {
    // A failed sync must not be lost: Stripe retries non-2xx deliveries with
    // backoff for up to three days, and every handler is safe to repeat.
    console.error('[stripe webhook] handler error', { type: event.type, id: event.id, error: e instanceof Error ? e.message : e });
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(stripe: Stripe, event: Stripe.Event) {
  const admin = createAdminClient();
  switch (event.type) {
    case 'checkout.session.completed':
      return recordCheckout(stripe, admin, event.data.object);

    case 'customer.created':
    case 'customer.updated':
      return recordStripeCustomer(admin, event.data.object);

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return syncSubscription(stripe, admin, event.data.object.id);

    default:
      // Unsubscribed or new event types are acknowledged and ignored.
      return;
  }
}
