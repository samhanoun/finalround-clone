import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { jsonError } from '@/lib/api';
import { llmProvider, requireEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import {
  fallbackMockInterviewReport,
  normalizeMockInterviewReport,
  reportToLegacyPayload,
} from '@/lib/mockInterviewReport';

interface Params {
  params: Promise<{ id: string }>;
}

type EventRow = {
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

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
    logCopilotRouteError('/api/copilot/sessions/[id]/summarize', requestId, 'db_fetch_events_failed', {
      sessionId: id,
      code: eventsError.code ?? null,
    });
    return internalError(requestId);
  }

  if (!events?.length) {
    return jsonError(400, 'no_events', { message: 'No session events to summarize' });
  }

  const transcript = compactSession(events);
  const mode = typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';

  let report = fallbackMockInterviewReport(mode);

  try {
    if (llmProvider() !== 'openai') {
      logCopilotRouteError('/api/copilot/sessions/[id]/summarize', requestId, 'unsupported_provider');
      return jsonError(400, 'unsupported_provider');
    }

    const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are an interview coach creating final evaluation reports. Be specific, concise, and actionable. Return strict JSON only.',
        },
        {
          role: 'user',
          content: `Mode: ${mode}\n\nSession log:\n${transcript}\n\nReturn JSON with keys:\n- overall_score (0-100 number)\n- hiring_signal (one of: strong_no_hire, no_hire, lean_no_hire, lean_hire, hire, strong_hire)\n- summary (string)\n- strengths (string[])\n- weaknesses (string[])\n- next_steps (string[])\n- rubric (object with dimensions: communication, technical_accuracy, problem_solving, structure, ownership, role_fit).\nEach dimension must include: score (1-5), evidence (string), recommendation (string).`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    report = normalizeMockInterviewReport(JSON.parse(raw), mode);
  } catch (e) {
    logCopilotRouteError('/api/copilot/sessions/[id]/summarize', requestId, 'llm_summary_failed', {
      sessionId: id,
      errorType: e instanceof Error ? e.name : 'unknown',
    });

    report = fallbackMockInterviewReport(mode);
  }

  const content = report.summary || 'Session summary generated.';
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
    logCopilotRouteError('/api/copilot/sessions/[id]/summarize', requestId, 'db_upsert_summary_failed', {
      sessionId: id,
      code: summaryError?.code ?? reportSummaryError?.code ?? null,
    });
    return internalError(requestId);
  }

  return NextResponse.json({ summary: savedSummary, report });
}
