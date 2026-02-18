import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET /api/social/shares - Get user's social share history
export async function GET() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: shares, error } = await supabase
    .from('social_shares')
    .select('*')
    .eq('user_id', user.id)
    .order('shared_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ shares });
}

// POST /api/social/shares - Record a social share
export async function POST(request: Request) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { share_type, platform, content_id, content_title, metadata } = body;

  if (!share_type || !platform) {
    return NextResponse.json({ error: 'Share type and platform are required' }, { status: 400 });
  }

  const { data: share, error } = await supabase
    .from('social_shares')
    .insert({
      user_id: user.id,
      share_type,
      platform,
      content_id,
      content_title,
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If sharing a badge or achievement, check for related badges
  if (share_type === 'badge' || share_type === 'achievement') {
    // Check if user earned the "social butterfly" badge for sharing first time
    const { data: existingShares } = await supabase
      .from('social_shares')
      .select('id')
      .eq('user_id', user.id);

    if (existingShares && existingShares.length === 1) {
      // First share - award badge
      await supabase.from('badges').insert({
        user_id: user.id,
        badge_type: 'referral_signup',
        title: 'Social Sharer',
        description: 'Shared your first achievement',
        icon: 'share',
        metadata: { share_id: share.id },
      });
    }
  }

  return NextResponse.json({ share });
}

// Generate share URLs for different platforms
export async function PUT(request: Request) {
  const body = await request.json();
  const { share_type, platform, content_title, content_url, content_summary } = body;

  if (!platform || !content_title) {
    return NextResponse.json({ error: 'Platform and content title are required' }, { status: 400 });
  }

  let shareUrl = '';
  const encodedTitle = encodeURIComponent(content_title);
  const encodedUrl = encodeURIComponent(content_url || '');
  const encodedSummary = encodeURIComponent(content_summary || '');

  switch (platform.toLowerCase()) {
    case 'linkedin':
      shareUrl = `https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedTitle}&summary=${encodedSummary}`;
      break;
    case 'twitter':
      shareUrl = `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`;
      break;
    case 'facebook':
      shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedTitle}`;
      break;
    case 'email':
      shareUrl = `mailto:?subject=${encodedTitle}&body=${encodedSummary}%0A%0A${encodedUrl}`;
      break;
    default:
      return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 });
  }

  return NextResponse.json({ share_url: shareUrl });
}
