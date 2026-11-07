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

  // One row per browser: signing in with another account on it moves the row.
  const { error } = await createAdminClient()
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
      },
      { onConflict: 'endpoint' },
    );
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
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
