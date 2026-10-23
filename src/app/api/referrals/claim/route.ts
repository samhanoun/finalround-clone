import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { claimReferral, normalizeReferralCode } from '@/lib/referrals';

/**
 * Credits the referrer whose link this account signed up with. The code comes
 * from the account's sign-up metadata (set by the sign-up form from ?ref=),
 * so it is safe to call on every visit: only the first claim counts.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return jsonError(401, 'unauthorized');

  const rl = await rateLimit({ key: `referrals:claim:${user.id}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) return jsonError(429, 'rate_limited');

  const code = normalizeReferralCode(user.user_metadata?.referral_code);
  if (!code) return NextResponse.json({ result: 'no_code' });

  try {
    const result = await claimReferral(createAdminClient(), code, user.id);
    return NextResponse.json({ result });
  } catch (error) {
    console.error('[referrals] claim failed', error instanceof Error ? error.message : error);
    return jsonError(500, 'claim_failed');
  }
}
