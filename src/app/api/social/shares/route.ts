import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

/** The values social_shares' checks allow (share_type: migrations 0016 and 0033; platform: 0016). */
const ShareSchema = z.object({
  share_type: z.enum(['interview_report', 'badge', 'achievement', 'job_offer', 'referral']),
  platform: z.enum(['linkedin', 'twitter', 'facebook', 'email']),
  content_id: z.string().max(200).nullish(),
  content_title: z.string().max(500).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});

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

/**
 * POST /api/social/shares - Record a social share.
 * 400 `invalid_body` for a type or platform the table doesn't take; 500
 * `share_not_recorded` when the insert fails, so callers can say so. Sharing
 * earns no badge: badges come from real milestones (src/lib/badges.ts).
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parse = ShareSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { share_type, platform, content_id, content_title, metadata } = parse.data;

  const { data: share, error } = await supabase
    .from('social_shares')
    .insert({
      user_id: user.id,
      share_type,
      platform,
      content_id: content_id ?? null,
      content_title: content_title ?? null,
      metadata: metadata ?? {},
    })
    .select()
    .single();

  if (error || !share) {
    console.error('[shares] could not record a share', { share_type, platform, error: error?.message });
    return NextResponse.json({ error: 'share_not_recorded' }, { status: 500 });
  }

  return NextResponse.json({ share });
}

// Generate share URLs for different platforms
export async function PUT(request: Request) {
  const body = await request.json();
  const { platform, content_title, content_url, content_summary } = body;

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
