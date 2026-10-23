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
    return NextResponse.json({ error: codeError.message }, { status: 500 });
  }

  let referralCodeData = existingCode;

  if (!referralCodeData) {
    const { data: newReferralCode, error: insertError } = await createAdminClient()
      .from('referral_codes')
      .insert({ user_id: user.id, code: generateReferralCode() })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    referralCodeData = newReferralCode;
  }

  const { data: referrals, error: referralsError } = await supabase
    .from('referral_tracking')
    .select('*')
    .eq('referrer_id', user.id)
    .order('created_at', { ascending: false });

  if (referralsError) {
    return NextResponse.json({ error: referralsError.message }, { status: 500 });
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
