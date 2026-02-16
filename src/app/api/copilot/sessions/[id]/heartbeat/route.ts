import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { isSessionHeartbeatExpired, withHeartbeatMetadata } from '@/lib/copilotSession';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:heartbeat:${ip}`, limit: 240, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, started_at, metadata')
    .eq('id', id)
    .single<{
      id: string;
      user_id: string;
      status: string;
      started_at: string;
      metadata: Record<string, unknown> | null;
    }>();

  if (sessionError || !session) return jsonError(404, 'session_not_found');
  if (session.user_id !== userData.user.id) return jsonError(403, 'forbidden');

  if (session.status !== 'active') {
    return NextResponse.json({ ok: true, state: 'already_closed' });
  }

  const nowIso = new Date().toISOString();

  if (isSessionHeartbeatExpired(session)) {
    const { error: expireError } = await supabase
      .from('copilot_sessions')
      .update({
        status: 'expired',
        stopped_at: nowIso,
        metadata: {
          ...withHeartbeatMetadata(session.metadata, nowIso),
          expired_reason: 'heartbeat_timeout',
        },
      })
      .eq('id', session.id)
      .eq('user_id', session.user_id)
      .eq('status', 'active');

    if (expireError) return jsonError(500, 'db_error', expireError);
    return NextResponse.json({ ok: false, state: 'expired' }, { status: 409 });
  }

  const { error: heartbeatError } = await supabase
    .from('copilot_sessions')
    .update({
      metadata: withHeartbeatMetadata(session.metadata, nowIso),
    })
    .eq('id', session.id)
    .eq('user_id', session.user_id)
    .eq('status', 'active');

  if (heartbeatError) return jsonError(500, 'db_error', heartbeatError);

  return NextResponse.json({ ok: true, heartbeat_at: nowIso });
}
