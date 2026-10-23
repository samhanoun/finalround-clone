import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Referral attribution, written with the service role only: users can't
 * credit themselves or anyone else from the browser.
 * - claimReferral: once per new account, after sign-up with ?ref=CODE.
 * - markReferralConverted: when that account starts a paid subscription
 *   (Stripe webhook).
 */

export type ClaimResult = 'claimed' | 'already_claimed' | 'invalid_code' | 'own_code';

export function normalizeReferralCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const cleaned = code.trim().toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(cleaned) ? cleaned : null;
}

export async function claimReferral(admin: SupabaseClient, code: string, refereeId: string): Promise<ClaimResult> {
  const { data: owner } = await admin
    .from('referral_codes')
    .select('user_id, referral_count')
    .eq('code', code)
    .maybeSingle<{ user_id: string; referral_count: number | null }>();
  if (!owner) return 'invalid_code';
  if (owner.user_id === refereeId) return 'own_code';

  // One referrer per account, ever.
  const { data: existing } = await admin
    .from('referral_tracking')
    .select('id')
    .eq('referee_id', refereeId)
    .limit(1);
  if (existing && existing.length > 0) return 'already_claimed';

  const now = new Date().toISOString();
  const { error } = await admin.from('referral_tracking').insert({
    referrer_id: owner.user_id,
    referee_id: refereeId,
    referral_code: code,
    status: 'signed_up',
    source: 'signup_link',
    clicked_at: now,
    signed_up_at: now,
  });
  if (error) throw new Error(`Could not record the referral: ${error.message}`);

  await admin
    .from('referral_codes')
    .update({ referral_count: (owner.referral_count ?? 0) + 1 })
    .eq('user_id', owner.user_id);
  return 'claimed';
}

/** Marks the account's referral converted the first time it pays. Never throws: billing must not fail over this. */
export async function markReferralConverted(admin: SupabaseClient, refereeId: string): Promise<boolean> {
  try {
    const { data: tracking } = await admin
      .from('referral_tracking')
      .update({ status: 'converted', converted_at: new Date().toISOString() })
      .eq('referee_id', refereeId)
      .eq('status', 'signed_up')
      .select('referral_code, referrer_id')
      .maybeSingle<{ referral_code: string; referrer_id: string }>();
    if (!tracking) return false;

    const { data: owner } = await admin
      .from('referral_codes')
      .select('conversion_count')
      .eq('user_id', tracking.referrer_id)
      .maybeSingle<{ conversion_count: number | null }>();
    await admin
      .from('referral_codes')
      .update({ conversion_count: (owner?.conversion_count ?? 0) + 1 })
      .eq('user_id', tracking.referrer_id);
    return true;
  } catch (error) {
    console.error('[referrals] could not mark the conversion', error instanceof Error ? error.message : error);
    return false;
  }
}
