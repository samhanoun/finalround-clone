import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Referral attribution, written with the service role only (migration 0029
 * leaves users read access): users can't credit themselves or anyone else.
 * - claimReferral: once per new account, after sign-up with ?ref=CODE.
 * - markReferralConverted: when that account starts a paid subscription
 *   (Stripe webhook).
 * Counts are derived from these rows (GET /api/referrals), not stored.
 */

export type ClaimResult = 'claimed' | 'already_claimed' | 'invalid_code' | 'own_code';

/** A referral can only be claimed this soon after sign-up. */
export const CLAIM_WINDOW_DAYS = 7;

export function normalizeReferralCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const cleaned = code.trim().toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(cleaned) ? cleaned : null;
}

/** True while the account is new enough to claim the referral it signed up with. */
export function withinClaimWindow(createdAt: string | undefined, now = new Date()): boolean {
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  if (Number.isNaN(created)) return false;
  return now.getTime() - created <= CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export async function claimReferral(admin: SupabaseClient, code: string, refereeId: string): Promise<ClaimResult> {
  const { data: owner } = await admin
    .from('referral_codes')
    .select('user_id')
    .eq('code', code)
    .maybeSingle<{ user_id: string }>();
  if (!owner) return 'invalid_code';
  if (owner.user_id === refereeId) return 'own_code';

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
  // One referrer per account: a unique index on referee_id makes a second claim fail, even a concurrent one.
  if (error?.code === '23505') return 'already_claimed';
  if (error) throw new Error(`Could not record the referral: ${error.message}`);
  return 'claimed';
}

/** Marks the account's referral converted the first time it pays. Never throws: billing must not fail over this. */
export async function markReferralConverted(admin: SupabaseClient, refereeId: string): Promise<boolean> {
  try {
    const { data } = await admin
      .from('referral_tracking')
      .update({ status: 'converted', converted_at: new Date().toISOString() })
      .eq('referee_id', refereeId)
      .eq('status', 'signed_up')
      .select('id')
      .maybeSingle<{ id: string }>();
    return Boolean(data);
  } catch (error) {
    console.error('[referrals] could not mark the conversion', error instanceof Error ? error.message : error);
    return false;
  }
}
