import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import {
  getBillableMinutes,
  getCopilotQuotaSnapshot,
  getElapsedUsage,
  recordCopilotUsage,
} from '@/lib/copilot';
import { revokeConsentMetadata } from '@/lib/copilotConsent';

const BodySchema = z.object({
  sessionId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:stop:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, started_at, stopped_at, duration_seconds, consumed_minutes, metadata')
    .eq('id', parse.data.sessionId)
    .single();

  if (sessionError || !session) return jsonError(404, 'session_not_found');
  if (session.user_id !== userId) return jsonError(403, 'forbidden');

  if (session.status !== 'active') {
    return NextResponse.json({
      session,
      usage: {
        elapsed_seconds: session.duration_seconds,
        billed_minutes: session.consumed_minutes,
        already_stopped: true,
      },
    });
  }

  const usage = getElapsedUsage(session.started_at);
  const quota = await getCopilotQuotaSnapshot(userId);
  const billableMinutes = getBillableMinutes(usage.elapsedMinutes, quota);

  await recordCopilotUsage(userId, billableMinutes);

  // Revoke consent when session is stopped
  const nowIso = new Date().toISOString();
  const consentRevocation = revokeConsentMetadata(session.metadata, nowIso);

  const { data: updated, error: updateError } = await supabase
    .from('copilot_sessions')
    .update({
      status: 'stopped',
      stopped_at: nowIso,
      duration_seconds: usage.elapsedSeconds,
      consumed_minutes: billableMinutes,
      metadata: {
        ...(typeof session.metadata === 'object' && session.metadata !== null ? session.metadata : {}),
        quota_snapshot: quota,
        requested_minutes: usage.elapsedMinutes,
        ...consentRevocation,
      },
    })
    .eq('id', session.id)
    .eq('user_id', userId)
    .select('id, user_id, interview_session_id, title, metadata, status, started_at, stopped_at, duration_seconds, consumed_minutes, created_at, updated_at')
    .single();

  if (updateError) return jsonError(500, 'db_error', updateError);

  return NextResponse.json({
    session: updated,
    usage: {
      elapsed_seconds: usage.elapsedSeconds,
      requested_minutes: usage.elapsedMinutes,
      billed_minutes: billableMinutes,
      quota_limited: billableMinutes < usage.elapsedMinutes,
      remaining_after: {
        monthly: Math.max(0, quota.monthly.remaining - billableMinutes),
        daily: Math.max(0, quota.daily.remaining - billableMinutes),
        per_session: Math.max(0, quota.perSession.remaining - billableMinutes),
      },
    },
  });
}
