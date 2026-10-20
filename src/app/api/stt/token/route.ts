import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { getCopilotQuotaSnapshot, getElapsedUsage } from '@/lib/copilot';
import { isSessionHeartbeatExpired } from '@/lib/copilotSession';
import { buildDeepgramListenUrl } from '@/lib/stt/deepgramListenUrl';

/**
 * POST /api/stt/token — mints a short-lived Deepgram token for one active
 * copilot session, so the browser streams audio straight to Deepgram without
 * ever holding the API key. The token only has to be valid when the WebSocket
 * opens; the client asks for a new one on every reconnect.
 */

const DEEPGRAM_GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';
const TOKEN_TTL_SECONDS = 30;
const GRANT_TIMEOUT_MS = 5_000;

const BodySchema = z.object({
  sessionId: z.string().uuid(),
});

const GrantSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

function logSttRouteError(requestId: string, errorClass: string, meta?: Record<string, unknown>) {
  console.error('[stt]', { route: '/api/stt/token', requestId, errorClass, ...(meta ?? {}) });
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipRl = await rateLimit({ key: `stt:token:ip:${ip}`, limit: 30, windowMs: 60_000 });
  if (!ipRl.ok) return jsonError(429, 'rate_limited');

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  // A connect plus a handful of reconnects per minute is normal; more is a loop.
  const userRl = await rateLimit({ key: `stt:token:user:${userId}`, limit: 12, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, started_at, metadata')
    .eq('id', parse.data.sessionId)
    .single<{
      id: string;
      user_id: string;
      status: string;
      started_at: string;
      metadata: Record<string, unknown> | null;
    }>();

  if (sessionError || !session || session.user_id !== userId) return jsonError(404, 'session_not_found');
  if (session.status !== 'active') return jsonError(409, 'session_not_active');
  if (isSessionHeartbeatExpired(session)) return jsonError(409, 'session_expired');

  // Minutes are only recorded when the session stops, so compare the time
  // already spent in this session with what the plan has left.
  const quota = await getCopilotQuotaSnapshot(userId);
  const remainingMinutes = Math.min(quota.monthly.remaining, quota.daily.remaining, quota.perSession.remaining);
  if (getElapsedUsage(session.started_at).elapsedMinutes > remainingMinutes) {
    return jsonError(403, 'quota_exceeded');
  }

  const apiKey = env.DEEPGRAM_API_KEY;
  if (!apiKey) return jsonError(503, 'stt_not_configured');

  let grant: z.infer<typeof GrantSchema>;
  try {
    const res = await fetch(DEEPGRAM_GRANT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: AbortSignal.timeout(GRANT_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      logSttRouteError(requestId, 'deepgram_grant_failed', { status: res.status });
      return jsonError(502, 'stt_token_failed', { requestId });
    }
    const parsed = GrantSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      logSttRouteError(requestId, 'deepgram_grant_malformed');
      return jsonError(502, 'stt_token_failed', { requestId });
    }
    grant = parsed.data;
  } catch (e) {
    logSttRouteError(requestId, 'deepgram_grant_unreachable', { name: e instanceof Error ? e.name : 'unknown' });
    return jsonError(502, 'stt_token_failed', { requestId });
  }

  return NextResponse.json(
    {
      token: grant.access_token,
      expiresIn: grant.expires_in ?? TOKEN_TTL_SECONDS,
      listenUrl: buildDeepgramListenUrl({ model: env.DEEPGRAM_MODEL, language: env.DEEPGRAM_LANGUAGE }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
