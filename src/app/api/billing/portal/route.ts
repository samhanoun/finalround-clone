import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { env } from '@/lib/env';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/locales';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rateLimit';
import { getStripe } from '@/lib/stripe';
import { findStripeCustomerId } from '@/lib/billing';

/**
 * POST /api/billing/portal — opens Stripe's billing portal (change card,
 * see invoices, cancel) for the signed-in user's own customer.
 */

export const runtime = 'nodejs';

const BodySchema = z.object({
  locale: z.enum(LOCALES).default(DEFAULT_LOCALE),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  const rl = await rateLimit({ key: `billing:portal:user:${userId}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) return jsonError(429, 'rate_limited');

  const parse = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const stripe = getStripe();
  if (!stripe) return jsonError(503, 'billing_unavailable');

  const customer = await findStripeCustomerId(createAdminClient(), userId);
  if (!customer) return jsonError(404, 'no_billing_account');

  const origin = env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${origin}/${parse.data.locale}/settings`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[billing] portal failed', { userId, error: e instanceof Error ? e.message : e });
    return jsonError(502, 'portal_failed');
  }
}
