import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { env } from '@/lib/env';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/locales';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rateLimit';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { getOrCreateStripeCustomer, proPriceId } from '@/lib/billing';

/**
 * POST /api/billing/checkout — starts a Stripe Checkout for Pro and returns
 * its URL. The price comes from the server's PRICE_ID_PRO_* settings; the
 * client only picks the currency.
 */

export const runtime = 'nodejs';

const BodySchema = z.object({
  currency: z.enum(['eur', 'usd']).default('usd'),
  locale: z.enum(LOCALES).default(DEFAULT_LOCALE),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');
  const user = userData.user;

  const rl = await rateLimit({ key: `billing:checkout:user:${user.id}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) return jsonError(429, 'rate_limited');

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());
  const { currency, locale } = parse.data;

  const stripe = getStripe();
  const price = proPriceId(currency);
  if (!stripe || !isStripeConfigured() || !price) return jsonError(503, 'billing_unavailable');

  const admin = createAdminClient();
  const { data: current } = await admin
    .from('subscriptions')
    .select('id')
    .eq('user_id', user.id)
    .eq('plan_id', 'pro')
    .eq('status', 'active')
    .maybeSingle();
  if (current) return jsonError(409, 'already_subscribed');

  const origin = env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  try {
    const customer = await getOrCreateStripeCustomer(stripe, admin, { id: user.id, email: user.email });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id } },
      allow_promotion_codes: true,
      success_url: `${origin}/${locale}/settings?billing=success`,
      cancel_url: `${origin}/${locale}/settings?billing=cancelled`,
    });
    if (!session.url) return jsonError(502, 'checkout_failed');
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[billing] checkout failed', { userId: user.id, error: e instanceof Error ? e.message : e });
    return jsonError(502, 'checkout_failed');
  }
}
