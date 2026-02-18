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
  let { data: referralCode, error: codeError } = await supabase
    .from('referral_codes')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (codeError && codeError.code !== 'PGRST116') {
    return NextResponse.json({ error: codeError.message }, { status: 500 });
  }

  // Create new referral code if none exists
  if (!referralCode) {
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
    
    referralCode = newReferralCode;
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
    referral_code: referralCode,
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
    .select('user_id')
    .eq('code', code.toUpperCase())
    .single();

  if (codeError || !referralCode) {
    return NextResponse.json({ error: 'Invalid referral code' }, { status: 404 });
  }

  // Check if this referral already exists
  const { data: existingTracking, error: existingError } = await supabase
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

    // Increment referral count
    await supabase
      .from('referral_codes')
      .update({ referral_count: (referralCode.referral_count || 0) + 1 })
      .eq('user_id', referralCode.user_id);

    return NextResponse.json({ tracking });
  }

  return NextResponse.json({ tracking: existingTracking });
}

// PUT /api/referrals - Update referral status (sign up, conversion)
export async function PUT(request: Request) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { referral_code, status } = body;

  if (!referral_code || !status) {
    return NextResponse.json({ error: 'Referral code and status are required' }, { status: 400 });
  }

  // Update tracking status
  const updateData: Record<string, unknown> = { status };
  if (status === 'signed_up') {
    updateData.signed_up_at = new Date().toISOString();
    updateData.referee_id = user.id;
  } else if (status === 'converted') {
    updateData.converted_at = new Date().toISOString();
  }

  const { data: tracking, error } = await supabase
    .from('referral_tracking')
    .update(updateData)
    .eq('referral_code', referral_code.toUpperCase())
    .eq('referee_id', user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update conversion count for referrer
  if (status === 'converted') {
    const { data: referralCode } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('code', referral_code.toUpperCase())
      .single();

    if (referralCode) {
      await supabase
        .from('referral_codes')
        .update({ conversion_count: (referralCode.conversion_count || 0) + 1 })
        .eq('user_id', referralCode.user_id);

      // Award badge to referrer
      await supabase.from('badges').insert({
        user_id: referralCode.user_id,
        badge_type: 'referral_conversion',
        title: 'Referral Champion',
        description: 'Successfully referred a new user who converted',
        icon: 'trophy',
        metadata: { referee_id: user.id },
      });
    }
  }

  return NextResponse.json({ tracking });
}
