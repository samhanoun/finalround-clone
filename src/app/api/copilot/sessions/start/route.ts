import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { getCopilotQuotaSnapshot } from '@/lib/copilot';
import { withHeartbeatMetadata } from '@/lib/copilotSession';
import { grantConsentMetadata } from '@/lib/copilotConsent';

const BodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  interviewSessionId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:start:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const quota = await getCopilotQuotaSnapshot(userId);

  if (!quota.monthly.allowed || !quota.daily.allowed || !quota.perSession.allowed) {
    return jsonError(403, 'quota_exceeded', {
      copilot_minutes: quota.monthly,
      copilot_daily_minutes: quota.daily,
      copilot_session_minutes: quota.perSession,
    });
  }

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('copilot_sessions')
    .insert({
      user_id: userId,
      interview_session_id: parse.data.interviewSessionId ?? null,
      title: parse.data.title ?? null,
      metadata: grantConsentMetadata(withHeartbeatMetadata(parse.data.metadata ?? {}, nowIso), nowIso),
      status: 'active',
      started_at: nowIso,
    })
    .select('id, user_id, interview_session_id, title, metadata, status, started_at, stopped_at, duration_seconds, consumed_minutes, created_at, updated_at')
    .single();

  if (error) return jsonError(500, 'db_error', error);

  return NextResponse.json({
    session: data,
    quota: {
      monthly_remaining: quota.monthly.remaining,
      daily_remaining: quota.daily.remaining,
      per_session_remaining: quota.perSession.remaining,
    },
  }, { status: 201 });
}
