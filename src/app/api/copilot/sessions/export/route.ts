import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

function getClientIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
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

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
  const ip = getClientIp(req);

  const anonymousRl = await rateLimit({ key: `copilot:export:anon:${ip}`, limit: 30, windowMs: 60_000 });
  if (!anonymousRl.ok) return jsonError(429, 'rate_limited');

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const userRl = await rateLimit({ key: `copilot:export:user:${userId}`, limit: 20, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  const [{ data: sessions, error: sessionsError }, { data: events, error: eventsError }, { data: summaries, error: summariesError }] = await Promise.all([
    supabase
      .from('copilot_sessions')
      .select('id, interview_session_id, title, metadata, status, started_at, stopped_at, duration_seconds, consumed_minutes, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase
      .from('copilot_events')
      .select('id, session_id, event_type, payload, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase
      .from('copilot_summaries')
      .select('id, session_id, summary_type, content, payload, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  ]);

  if (sessionsError) {
    logCopilotRouteError('/api/copilot/sessions/export', requestId, 'db_fetch_sessions_failed', {
      code: sessionsError.code ?? null,
    });
    return internalError(requestId);
  }

  if (eventsError) {
    logCopilotRouteError('/api/copilot/sessions/export', requestId, 'db_fetch_events_failed', {
      code: eventsError.code ?? null,
    });
    return internalError(requestId);
  }

  if (summariesError) {
    logCopilotRouteError('/api/copilot/sessions/export', requestId, 'db_fetch_summaries_failed', {
      code: summariesError.code ?? null,
    });
    return internalError(requestId);
  }

  const exportPayload = {
    request_id: requestId,
    exported_at: new Date().toISOString(),
    user_id: userId,
    counts: {
      sessions: sessions?.length ?? 0,
      events: events?.length ?? 0,
      summaries: summaries?.length ?? 0,
    },
    sessions: sessions ?? [],
    events: events ?? [],
    summaries: summaries ?? [],
  };

  const filename = `copilot-data-export-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
