import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rateLimit';
import { isPushConfigured } from '@/lib/notify';

/**
 * Browsers where the signed-in user turned on "Notify me on this device".
 * Stored with the service role (users can only read their own rows).
 */

const SubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().startsWith('https://').max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
});
const RemoveSchema = z.object({ endpoint: z.string().url().max(1000) });

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function signedInUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// POST /api/push/subscriptions - register this browser
export async function POST(request: NextRequest) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isPushConfigured()) return NextResponse.json({ error: 'push_not_configured' }, { status: 503 });

  const rl = await rateLimit({ key: `push_subscribe:${user.id}`, limit: 20, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = SubscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
  const { endpoint, keys } = parse.data.subscription;

  const admin = createAdminClient();
  const row = {
    user_id: user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
  };
  const { data: existing, error: lookupError } = await admin
    .from('push_subscriptions')
    .select('user_id, p256dh, auth')
    .eq('endpoint', endpoint)
    .maybeSingle<{ user_id: string; p256dh: string; auth: string }>();
  if (lookupError) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  if (!existing) {
    const { error } = await admin.from('push_subscriptions').insert(row);
    // Registered by someone else a moment ago: the browser can subscribe afresh.
    if (error?.code === '23505') return NextResponse.json({ error: 'endpoint_in_use' }, { status: 409 });
    if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  // One row per browser. Another account signing in on the same browser may
  // take the row over, but only by showing the subscription's own keys (the
  // auth secret never leaves that browser); knowing the endpoint isn't enough.
  if (existing.user_id !== user.id && !(existing.p256dh === keys.p256dh && sameSecret(existing.auth, keys.auth))) {
    return NextResponse.json({ error: 'endpoint_in_use' }, { status: 409 });
  }
  const { data: moved, error } = await admin
    .from('push_subscriptions')
    .update(row)
    .eq('endpoint', endpoint)
    .eq('user_id', existing.user_id)
    .eq('auth', existing.auth)
    .select('id');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!moved?.length) return NextResponse.json({ error: 'endpoint_in_use' }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 201 });
}

// DELETE /api/push/subscriptions {endpoint} - stop notifications on this browser
export async function DELETE(request: NextRequest) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parse = RemoveSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { error } = await createAdminClient()
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', parse.data.endpoint);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
