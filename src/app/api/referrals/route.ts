import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

// Generate a unique referral code
function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// GET /api/referrals - Get user's referral code and stats
export async function GET() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get or create referral code
  const { data: existingCode, error: codeError } = await supabase
    .from('referral_codes')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (codeError && codeError.code !== 'PGRST116') {
    return NextResponse.json({ error: codeError.message }, { status: 500 });
  }

  let referralCodeData = existingCode;

  // Create new referral code if none exists
  if (!referralCodeData) {
    const newCode = generateReferralCode();
    
    const { data: newReferralCode, error: insertError } = await supabase
      .from('referral_codes')
      .insert({
        user_id: user.id,
        code: newCode,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    
    referralCodeData = newReferralCode;
  }

  // Get referral tracking data
  const { data: referrals, error: referralsError } = await supabase
    .from('referral_tracking')
    .select('*')
    .eq('referrer_id', user.id)
    .order('created_at', { ascending: false });

  if (referralsError) {
    return NextResponse.json({ error: referralsError.message }, { status: 500 });
  }

  return NextResponse.json({
    referral_code: referralCodeData,
    referrals: referrals || [],
  });
}

// POST /api/referrals - Track a new referral click
export async function POST(request: Request) {
  const supabase = await createClient();
  
  const body = await request.json();
  const { code, source, utm_campaign, utm_medium, utm_source } = body;

  if (!code) {
    return NextResponse.json({ error: 'Referral code is required' }, { status: 400 });
  }

  // Get referrer user ID from code
  const { data: referralCode, error: codeError } = await supabase
    .from('referral_codes')
    .select('*')
    .eq('code', code.toUpperCase())
    .single();

  if (codeError || !referralCode) {
    return NextResponse.json({ error: 'Invalid referral code' }, { status: 404 });
  }

  // Check if this referral already exists
  const { data: existingTracking } = await supabase
    .from('referral_tracking')
    .select('*')
    .eq('referral_code', code.toUpperCase())
    .eq('status', 'pending')
    .order('clicked_at', { ascending: false })
    .limit(1)
    .single();

  // Create or update tracking
  if (!existingTracking) {
    const { data: tracking, error: insertError } = await supabase
      .from('referral_tracking')
      .insert({
        referrer_id: referralCode.user_id,
        referral_code: code.toUpperCase(),
        source,
        utm_campaign,
        utm_medium,
        utm_source,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // referral_count counts sign-ups (see claimReferral), not clicks.
    return NextResponse.json({ tracking });
  }

  return NextResponse.json({ tracking: existingTracking });
}

// Sign-ups are credited by POST /api/referrals/claim and conversions by the
// Stripe webhook (src/lib/referrals.ts), both with the service role: a
// browser can't mark its own referral as signed up or paid.
