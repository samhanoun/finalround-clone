import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

const DELETE_ALL_CONFIRMATION = 'DELETE ALL COPILOT DATA';

function getClientIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function DELETE(req: NextRequest) {
  const ip = getClientIp(req);
  const anonymousRl = await rateLimit({ key: `copilot:purge:anon:${ip}`, limit: 10, windowMs: 60_000 });
  if (!anonymousRl.ok) return jsonError(429, 'rate_limited');

  const body = (await req.json().catch(() => null)) as { confirmation?: string } | null;
  if (!body || body.confirmation !== DELETE_ALL_CONFIRMATION) {
    return jsonError(400, 'invalid_confirmation');
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const userRl = await rateLimit({ key: `copilot:purge:user:${userId}`, limit: 5, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  const [
    { count: eventCount, error: eventCountError },
    { count: summaryCount, error: summaryCountError },
    { count: sessionCount, error: sessionCountError },
    { count: activeSessionCount, error: activeSessionCountError },
  ] = await Promise.all([
    supabase.from('copilot_events').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('copilot_summaries').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('copilot_sessions').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('copilot_sessions').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active'),
  ]);

  if (eventCountError || summaryCountError || sessionCountError || activeSessionCountError) {
    return jsonError(500, 'db_error');
  }

  if ((activeSessionCount ?? 0) > 0) {
    return jsonError(409, 'session_active', { message: 'Stop active sessions before deleting all copilot data.' });
  }

  const { error: eventsDeleteError } = await supabase.from('copilot_events').delete().eq('user_id', userId);
  if (eventsDeleteError) return jsonError(500, 'db_error');

  const { error: summariesDeleteError } = await supabase.from('copilot_summaries').delete().eq('user_id', userId);
  if (summariesDeleteError) return jsonError(500, 'db_error');

  const { error: sessionsDeleteError } = await supabase.from('copilot_sessions').delete().eq('user_id', userId);
  if (sessionsDeleteError) return jsonError(500, 'db_error');

  return NextResponse.json({
    ok: true,
    deleted: {
      events: eventCount ?? 0,
      summaries: summaryCount ?? 0,
      sessions: sessionCount ?? 0,
    },
  });
}
