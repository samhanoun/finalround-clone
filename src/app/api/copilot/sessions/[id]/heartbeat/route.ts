import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { endCopilotSession } from '@/lib/copilot/endSession';
import { rateLimit } from '@/lib/rateLimit';
import { isSessionHeartbeatExpired, withHeartbeatMetadata } from '@/lib/copilotSession';
import { sessionExpiredResponse } from '@/lib/copilotApiResponse';

interface Params {
  params: Promise<{ id: string }>;
}

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

function logCopilotRouteError(route: string, requestId: string, errorClass: string, meta?: Record<string, unknown>) {
  console.error('[copilot]', { route, requestId, errorClass, ...(meta ?? {}) });
}

function internalError(requestId: string) {
  return jsonError(500, 'internal_error', { requestId });
}

export async function POST(req: NextRequest, { params }: Params) {
  const requestId = getRequestId(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:heartbeat:${ip}`, limit: 240, windowMs: 60_000 });
  if (!rl.ok) return jsonError(429, 'rate_limited');

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
  if (session.user_id !== userData.user.id) return jsonError(404, 'session_not_found');

  if (session.status !== 'active') {
    return NextResponse.json({ ok: true, state: 'already_closed' });
  }

  const nowIso = new Date().toISOString();

  if (isSessionHeartbeatExpired(session)) {
    const { error: expireError } = await endCopilotSession(session, {
      status: 'expired',
      endedAt: new Date(nowIso),
      metadata: { expired_reason: 'heartbeat_timeout' },
    });

    if (expireError) {
      logCopilotRouteError('/api/copilot/sessions/[id]/heartbeat', requestId, 'db_expire_session_failed', {
        sessionId: session.id,
        code: expireError.code ?? null,
      });
      return internalError(requestId);
    }
    return sessionExpiredResponse(session, nowIso);
  }

  // Users can't write sessions themselves (migration 0028): the heartbeat is
  // what expiry billing trusts, so only the server records it.
  const { error: heartbeatError } = await createAdminClient()
    .from('copilot_sessions')
    .update({
      metadata: withHeartbeatMetadata(session.metadata, nowIso),
    })
    .eq('id', session.id)
    .eq('user_id', session.user_id)
    .eq('status', 'active');

  if (heartbeatError) {
    logCopilotRouteError('/api/copilot/sessions/[id]/heartbeat', requestId, 'db_update_heartbeat_failed', {
      sessionId: session.id,
      code: heartbeatError.code ?? null,
    });
    return internalError(requestId);
  }

  return NextResponse.json({ ok: true, heartbeat_at: nowIso });
}
