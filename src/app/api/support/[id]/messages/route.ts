import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { replyAsUser } from '@/lib/support';

// POST /api/support/[id]/messages {content} - the user's reply on their ticket
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit({ key: `support_reply:${user.id}`, limit: 30, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await params;
  const parse = z.object({ content: z.string().trim().min(1).max(5000) }).safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  try {
    if (!(await replyAsUser(user.id, id, parse.data.content))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error('[support] reply not saved', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
