import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

const DELETE_ALL_CONFIRMATION = 'DELETE ALL COPILOT DATA';

const PurgeBodySchema = z.object({
  confirmation: z.string().min(1),
  confirmUserId: z.string().min(1).optional(),
});

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

export async function DELETE(req: NextRequest) {
  const requestId = getRequestId(req);
  const ip = getClientIp(req);
  const anonymousRl = await rateLimit({ key: `copilot:purge:anon:${ip}`, limit: 10, windowMs: 60_000 });
  if (!anonymousRl.ok) return jsonError(429, 'rate_limited');

  const parse = PurgeBodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  if (parse.data.confirmation !== DELETE_ALL_CONFIRMATION) {
    return jsonError(400, 'invalid_confirmation');
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const userRl = await rateLimit({ key: `copilot:purge:user:${userId}`, limit: 5, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  if (parse.data.confirmUserId && parse.data.confirmUserId !== userId) {
    return jsonError(403, 'confirmation_user_mismatch');
  }

  const [
    { count: eventCount, error: eventCountError },
    { count: summaryCount, error: summaryCountError },
    { count: sessionCount, error: sessionCountError },
    { count: activeSessionCount, error: activeSessionCountError },
  ] = await Promise.all([
    supabase.from('copilot_events').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('copilot_summaries').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('copilot_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('copilot_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active'),
  ]);

  if (eventCountError || summaryCountError || sessionCountError || activeSessionCountError) {
    logCopilotRouteError('/api/copilot/sessions/purge', requestId, 'db_count_records_failed', {
      eventsCode: eventCountError?.code ?? null,
      summariesCode: summaryCountError?.code ?? null,
      sessionsCode: sessionCountError?.code ?? null,
      activeSessionsCode: activeSessionCountError?.code ?? null,
    });
    return internalError(requestId);
  }

  if ((activeSessionCount ?? 0) > 0) {
    return jsonError(409, 'session_active', { message: 'Stop active sessions before deleting all copilot data.' });
  }

  const { error: eventsDeleteError } = await supabase.from('copilot_events').delete().eq('user_id', userId);
  if (eventsDeleteError) {
    logCopilotRouteError('/api/copilot/sessions/purge', requestId, 'db_delete_events_failed', {
      code: eventsDeleteError.code ?? null,
    });
    return internalError(requestId);
  }

  const { error: summariesDeleteError } = await supabase.from('copilot_summaries').delete().eq('user_id', userId);
  if (summariesDeleteError) {
    logCopilotRouteError('/api/copilot/sessions/purge', requestId, 'db_delete_summaries_failed', {
      code: summariesDeleteError.code ?? null,
    });
    return internalError(requestId);
  }

  const { error: sessionsDeleteError } = await supabase.from('copilot_sessions').delete().eq('user_id', userId);
  if (sessionsDeleteError) {
    logCopilotRouteError('/api/copilot/sessions/purge', requestId, 'db_delete_sessions_failed', {
      code: sessionsDeleteError.code ?? null,
    });
    return internalError(requestId);
  }

  return NextResponse.json({
    ok: true,
    requestId,
    deleted: {
      events: eventCount ?? 0,
      summaries: summaryCount ?? 0,
      sessions: sessionCount ?? 0,
    },
  });
}
