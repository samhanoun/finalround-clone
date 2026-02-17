import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { copilotOk, copilotRateLimited } from '@/lib/copilotApiResponse';
import { rateLimit } from '@/lib/rateLimit';
import { normalizeMockInterviewReport } from '@/lib/mockInterviewReport';

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export async function GET(req: NextRequest, { params }: Params) {
  const requestId = getRequestId(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const anonRl = await rateLimit({ key: `copilot:report:anon:${ip}`, limit: 120, windowMs: 60_000 });
  if (!anonRl.ok) return copilotRateLimited();

  const { id } = await params;
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const userRl = await rateLimit({ key: `copilot:report:user:${userId}`, limit: 240, windowMs: 60_000 });
  if (!userRl.ok) return copilotRateLimited();

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, metadata')
    .eq('id', id)
    .eq('user_id', userId)
    .single<{ id: string; user_id: string; metadata: Record<string, unknown> | null }>();

  if (sessionError || !session) return jsonError(404, 'session_not_found');

  const { data: summaries, error: summaryError } = await supabase
    .from('copilot_summaries')
    .select('id, summary_type, content, payload, created_at, updated_at')
    .eq('session_id', id)
    .eq('user_id', userId)
    .in('summary_type', ['mock_interview_report', 'final'])
    .order('updated_at', { ascending: false })
    .limit(5);

  if (summaryError) {
    logCopilotRouteError('/api/copilot/sessions/[id]/report', requestId, 'db_fetch_report_failed', {
      sessionId: id,
      code: summaryError.code ?? null,
    });
    return internalError(requestId);
  }

  const mode = typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';
  const reportSource = (summaries ?? []).find((row) => {
    const payload = asRecord(row.payload);
    return payload.report || payload.rubric || payload.overall_score;
  });

  if (!reportSource) {
    return jsonError(404, 'report_not_found');
  }

  const rawPayload = asRecord(reportSource.payload);
  const source = rawPayload.report ?? rawPayload;
  const report = normalizeMockInterviewReport(source, mode);

  const payload = {
    report,
    summary: reportSource,
  };

  return copilotOk(payload);
}
