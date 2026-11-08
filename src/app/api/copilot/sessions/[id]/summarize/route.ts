import { NextRequest, NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import { isLatencyPayload } from '@/lib/copilot/latency';
import { liveReportRequest } from '@/lib/copilot/sessionReport';
import { sessionModels } from '@/lib/answerModels';
import { isProviderConfigured, LLMUnavailableError, providerForModel } from '@/lib/llmRouter';
import { completeChat, extractJsonObject } from '@/lib/practice/practice';
import { normalizeMockInterviewReport, reportToLegacyPayload } from '@/lib/mockInterviewReport';

/**
 * POST /api/copilot/sessions/[id]/summarize: the session's interview report,
 * written by the answer model frozen into the session at start (Settings →
 * Answer model), OpenAI or Anthropic. Saved only when the model wrote a real
 * report: on any failure the route answers with an error and saves nothing.
 */

interface Params {
  params: Promise<{ id: string }>;
}

type EventRow = {
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const MODEL_TIMEOUT_MS = 60_000;
const ROUTE = '/api/copilot/sessions/[id]/summarize';

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

function logCopilotRouteError(route: string, requestId: string, errorClass: string, meta?: Record<string, unknown>) {
  console.error('[copilot]', { route, requestId, errorClass, ...(meta ?? {}) });
}

function internalError(requestId: string) {
  return jsonError(500, 'internal_error', { requestId });
}

function compactSession(events: EventRow[]) {
  return events
    .filter((row) => !isLatencyPayload(row.payload)) // timing rows are not conversation
    .map((row) => {
      const rawText = typeof row.payload.text === 'string' ? row.payload.text : '';
      const cleaned = sanitizeCopilotText(rawText);
      const speaker = typeof row.payload.speaker === 'string' ? row.payload.speaker : row.event_type;
      const text = cleaned.hasPromptInjection ? '[FILTERED_PROMPT_INJECTION_CONTENT]' : cleaned.sanitized;
      return `[${speaker}] ${text}`;
    })
    .join('\n');
}

export async function POST(req: NextRequest, { params }: Params) {
  const requestId = getRequestId(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:summary:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, metadata')
    .eq('id', id)
    .single<{ id: string; user_id: string; status: string; metadata: Record<string, unknown> | null }>();

  if (sessionError || !session) return jsonError(404, 'session_not_found');
  if (session.user_id !== userData.user.id) return jsonError(404, 'session_not_found');

  const { data: events, error: eventsError } = await supabase
    .from('copilot_events')
    .select('event_type, payload, created_at')
    .eq('session_id', id)
    .order('created_at', { ascending: true })
    .limit(250)
    .returns<EventRow[]>();

  if (eventsError) {
    logCopilotRouteError(ROUTE, requestId, 'db_fetch_events_failed', {
      sessionId: id,
      code: eventsError.code ?? null,
    });
    return internalError(requestId);
  }

  if (!events?.length) {
    return jsonError(400, 'no_events', { message: 'No session events to summarize' });
  }

  const mode = typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';
  // The session's answer model (frozen at start), through whichever provider serves it.
  const model = sessionModels(session.metadata).answer;
  const provider = providerForModel(model);
  if (!provider || !isProviderConfigured(provider)) {
    logCopilotRouteError(ROUTE, requestId, 'summary_unavailable', { sessionId: id, model });
    return jsonError(503, 'summary_unavailable');
  }

  let reply: string;
  try {
    reply = await completeChat({
      model,
      ...liveReportRequest(mode, compactSession(events)),
      temperature: 0.2,
      maxTokens: 1_500,
      // No request signal: a report the user leaves before it's ready still reaches Past sessions.
      timeoutMs: MODEL_TIMEOUT_MS,
    });
  } catch (e) {
    const unavailable = e instanceof LLMUnavailableError;
    logCopilotRouteError(ROUTE, requestId, unavailable ? 'summary_unavailable' : 'llm_summary_failed', {
      sessionId: id,
      model,
      errorType: e instanceof Error ? e.name : 'unknown',
    });
    return unavailable ? jsonError(503, 'summary_unavailable') : jsonError(502, 'summary_failed', { requestId });
  }

  // Never save a stand-in: a reply without a real overall score is no report.
  const report = normalizeMockInterviewReport(extractJsonObject(reply), mode);
  if (!report) {
    logCopilotRouteError(ROUTE, requestId, 'llm_summary_unusable', { sessionId: id, model });
    return jsonError(502, 'summary_failed', { requestId });
  }

  const content = report.summary;
  const payload = reportToLegacyPayload(report);

  const [{ data: savedSummary, error: summaryError }, { error: reportSummaryError }] = await Promise.all([
    supabase
      .from('copilot_summaries')
      .upsert(
        {
          session_id: id,
          user_id: userData.user.id,
          summary_type: 'final',
          content,
          payload,
        },
        { onConflict: 'session_id,summary_type' },
      )
      .select('id, summary_type, content, payload, created_at, updated_at')
      .single(),
    supabase.from('copilot_summaries').upsert(
      {
        session_id: id,
        user_id: userData.user.id,
        summary_type: 'mock_interview_report',
        content,
        payload,
      },
      { onConflict: 'session_id,summary_type' },
    ),
  ]);

  if (summaryError || reportSummaryError) {
    logCopilotRouteError(ROUTE, requestId, 'db_upsert_summary_failed', {
      sessionId: id,
      code: summaryError?.code ?? reportSummaryError?.code ?? null,
    });
    return internalError(requestId);
  }

  return NextResponse.json({ summary: savedSummary, report });
}
