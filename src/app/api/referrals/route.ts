import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

// Generate a unique referral code
function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * GET /api/referrals - the user's referral code and the people who signed up with it.
 *
 * Users can only read referral data (migration 0029): the code is created here
 * with the service role, sign-ups are credited by POST /api/referrals/claim, and
 * conversions by the Stripe webhook (src/lib/referrals.ts). The counts are
 * worked out from those rows, so there is no counter anyone could edit.
 */
export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: existingCode, error: codeError } = await supabase
    .from('referral_codes')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (codeError) {
    console.error('[referrals] code read failed', codeError.message);
    return NextResponse.json({ error: 'referrals_failed' }, { status: 500 });
  }

  let referralCodeData = existingCode;

  if (!referralCodeData) {
    // Two first visits at once (two tabs) would both insert; user_id is unique, so the second
    // insert is ignored and both read back the one code.
    const admin = createAdminClient();
    const { error: insertError } = await admin
      .from('referral_codes')
      .upsert({ user_id: user.id, code: generateReferralCode() }, { onConflict: 'user_id', ignoreDuplicates: true });
    const { data: created, error: readError } = insertError
      ? { data: null, error: insertError }
      : await admin.from('referral_codes').select('*').eq('user_id', user.id).maybeSingle();
    if (readError || !created) {
      console.error('[referrals] code not created', readError?.message);
      return NextResponse.json({ error: 'referrals_failed' }, { status: 500 });
    }

    referralCodeData = created;
  }

  const { data: referrals, error: referralsError } = await supabase
    .from('referral_tracking')
    .select('*')
    .eq('referrer_id', user.id)
    .order('created_at', { ascending: false });

  if (referralsError) {
    console.error('[referrals] list failed', referralsError.message);
    return NextResponse.json({ error: 'referrals_failed' }, { status: 500 });
  }

  const rows = referrals ?? [];
  return NextResponse.json({
    referral_code: {
      ...referralCodeData,
      referral_count: rows.filter((r) => r.status === 'signed_up' || r.status === 'converted').length,
      conversion_count: rows.filter((r) => r.status === 'converted').length,
    },
    referrals: rows,
  });
}
