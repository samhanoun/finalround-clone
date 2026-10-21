import Stripe from 'stripe';
import { env } from '@/lib/env';

// Stripe is server-only.
let _stripe: Stripe | null = null;

export function getStripe() {
  if (_stripe) return _stripe;
  if (!env.STRIPE_SECRET_KEY) return null;

  _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    // The version stripe-node 23 is built for; keep the webhook endpoint on the same version.
    apiVersion: '2026-09-30.endive',
  });

  return _stripe;
}

export const STRIPE_PRICE_IDS = {
  pro_eur: env.PRICE_ID_PRO_EUR ?? '',
  pro_usd: env.PRICE_ID_PRO_USD ?? '',
} as const;

export function isStripeConfigured() {
  return !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET;
}
