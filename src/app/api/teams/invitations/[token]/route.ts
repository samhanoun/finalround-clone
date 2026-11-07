import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { previewInvitation, respondToInvitation } from '@/lib/teamInvites';

type Params = { params: Promise<{ token: string }> };

const TOKEN = z.string().min(16).max(100);
const RespondSchema = z.object({ action: z.enum(['accept', 'decline']) });

function ipOf(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// GET /api/teams/invitations/[token] - what the link is for (team, role, address), before signing in
export async function GET(req: NextRequest, { params }: Params) {
  const rl = await rateLimit({ key: `team_invite_preview:${ipOf(req)}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const token = TOKEN.safeParse((await params).token);
  if (!token.success) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const invitation = await previewInvitation(token.data);
  if (!invitation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ invitation });
}

// POST /api/teams/invitations/[token] {action} - join the team, or decline
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit({ key: `team_invite_respond:${user.id}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const token = TOKEN.safeParse((await params).token);
  const body = RespondSchema.safeParse(await req.json().catch(() => null));
  if (!token.success) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  try {
    const result = await respondToInvitation(token.data, user, body.data.action);
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : result.error === 'wrong_account' ? 403 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[teams] invitation response failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
