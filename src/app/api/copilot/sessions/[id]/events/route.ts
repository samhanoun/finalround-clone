import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { llmProvider, requireEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import { isSessionHeartbeatExpired, withHeartbeatMetadata } from '@/lib/copilotSession';
import { buildSuggestionPrompt, parseSuggestionContent } from '@/lib/copilotSuggestion';
import { sessionExpiredResponse } from '@/lib/copilotApiResponse';
import { checkIngestConsent } from '@/lib/copilotConsent';
import {
  startLatencyTracking,
  startStage,
  endStage,
  getLatencyTimings,
  clearLatencyTracking,
  latencyTimingsToMetadata,
  logLatencyMetrics,
} from '@/lib/copilotLatency';

interface Params {
  params: Promise<{ id: string }>;
}

const BodySchema = z.object({
  eventType: z.enum(['transcript', 'system']).default('transcript'),
  speaker: z.enum(['interviewer', 'candidate', 'system']).default('interviewer'),
  text: z.string().min(1).max(4000),
  autoSuggest: z.boolean().optional(),
});

type EventPayload = Record<string, unknown>;

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
  const rl = await rateLimit({ key: `copilot:events:${ip}`, limit: 90, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const { id } = await params;
  
  // Start latency tracking for the pipeline (P0 T3)
  startLatencyTracking(requestId, id);
  startStage(requestId, 'ingest');
  
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    clearLatencyTracking(requestId);
    return jsonError(401, 'unauthorized');
  }

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, started_at, metadata')
    .eq('id', id)
    .single<{ id: string; user_id: string; status: string; started_at: string; metadata: Record<string, unknown> | null }>();

  if (sessionError || !session) {
    clearLatencyTracking(requestId);
    return jsonError(404, 'session_not_found');
  }
  if (session.user_id !== userData.user.id) {
    clearLatencyTracking(requestId);
    return jsonError(404, 'session_not_found');
  }

  if (isSessionHeartbeatExpired(session)) {
    const nowIso = new Date().toISOString();
    await supabase
      .from('copilot_sessions')
      .update({
        status: 'expired',
        stopped_at: nowIso,
        metadata: {
          ...withHeartbeatMetadata(session.metadata, nowIso),
          expired_reason: 'heartbeat_timeout',
        },
      })
      .eq('id', id)
      .eq('user_id', userData.user.id)
      .eq('status', 'active');

    clearLatencyTracking(requestId);
    return sessionExpiredResponse(session, nowIso);
  }

  if (session.status !== 'active') {
    clearLatencyTracking(requestId);
    return jsonError(409, 'session_not_active');
  }

  // P0 T2: Consent gate enforcement
  const consentCheck = checkIngestConsent(session);
  if (!consentCheck.allowed) {
    clearLatencyTracking(requestId);
    return jsonError(403, consentCheck.reason);
  }

  endStage(requestId, 'ingest');
  startStage(requestId, 'transcript_parse');

  const cleanedInput = sanitizeCopilotText(parse.data.text);

  const payload: EventPayload = {
    speaker: parse.data.speaker,
    text: cleanedInput.sanitized,
    mode: typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general',
    security: {
      redactions: cleanedInput.redactions,
      prompt_injection: cleanedInput.hasPromptInjection,
    },
  };

  endStage(requestId, 'transcript_parse');
  startStage(requestId, 'suggestion_persist');

  const { data: createdEvent, error: insertError } = await supabase
    .from('copilot_events')
    .insert({
      session_id: id,
      user_id: userData.user.id,
      event_type: parse.data.eventType,
      payload,
    })
    .select('id, event_type, payload, created_at')
    .single();

  if (insertError || !createdEvent) {
    logCopilotRouteError('/api/copilot/sessions/[id]/events', requestId, 'db_insert_event_failed', {
      sessionId: id,
      code: insertError?.code ?? null,
    });
    clearLatencyTracking(requestId);
    return internalError(requestId);
  }

  const shouldSuggest =
    parse.data.autoSuggest !== false &&
    parse.data.eventType === 'transcript' &&
    parse.data.speaker === 'interviewer' &&
    !cleanedInput.hasPromptInjection;

  if (!shouldSuggest) {
    endStage(requestId, 'suggestion_persist');
    startStage(requestId, 'delivery');
    
    const timings = getLatencyTimings(requestId);
    const latencyMeta = timings ? latencyTimingsToMetadata(timings) : {};
    
    endStage(requestId, 'delivery');
    logLatencyMetrics(getLatencyTimings(requestId)!, { skipped_suggestion: true });
    clearLatencyTracking(requestId);

    return NextResponse.json({
      event: createdEvent,
      suggestion: null,
      blocked: cleanedInput.hasPromptInjection,
      redactions: cleanedInput.redactions,
      ...latencyMeta,
    }, { status: 201 });
  }

  endStage(requestId, 'suggestion_persist');
  startStage(requestId, 'context_retrieval');

  const { data: transcriptRows } = await supabase
    .from('copilot_events')
    .select('id, payload, created_at')
    .eq('session_id', id)
    .eq('event_type', 'transcript')
    .order('created_at', { ascending: false })
    .limit(16);

  const ordered = (transcriptRows ?? []).slice().reverse();
  const transcriptText = ordered
    .map((row) => {
      const p = row.payload as EventPayload;
      const speaker = typeof p.speaker === 'string' ? p.speaker : 'unknown';
      const text = typeof p.text === 'string' ? p.text : '';
      return `${speaker}: ${text}`;
    })
    .join('\n');

  const mode = typeof payload.mode === 'string' ? payload.mode : 'general';

  endStage(requestId, 'context_retrieval');
  startStage(requestId, 'llm_inference');

  try {
    if (llmProvider() !== 'openai') {
      logCopilotRouteError('/api/copilot/sessions/[id]/events', requestId, 'unsupported_provider');
      clearLatencyTracking(requestId);
      return jsonError(400, 'unsupported_provider');
    }

    const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: buildSuggestionPrompt({
        mode,
        transcriptText: transcriptText || `${parse.data.speaker}: ${cleanedInput.sanitized}`,
        latestQuestion: cleanedInput.sanitized,
      }),
    });

    const content = completion.choices[0]?.message?.content ?? '{}';
    const parsedSuggestion = parseSuggestionContent(content, mode);

    endStage(requestId, 'llm_inference');
    startStage(requestId, 'suggestion_persist');

    const suggestionPayload: EventPayload = {
      category: 'answer',
      text: parsedSuggestion.shortAnswer,
      based_on_event_id: createdEvent.id,
      mode,
      structured: parsedSuggestion.structured,
    };

    if (parsedSuggestion.talkingPoints.length > 0) {
      suggestionPayload.talking_points = parsedSuggestion.talkingPoints;
    }

    if (parsedSuggestion.followUp) {
      suggestionPayload.follow_up = parsedSuggestion.followUp;
    }

    if (parsedSuggestion.complexity) {
      suggestionPayload.complexity = parsedSuggestion.complexity;
    }

    if (parsedSuggestion.edgeCases && parsedSuggestion.edgeCases.length > 0) {
      suggestionPayload.edge_cases = parsedSuggestion.edgeCases;
    }

    if (parsedSuggestion.checklist && parsedSuggestion.checklist.length > 0) {
      suggestionPayload.checklist = parsedSuggestion.checklist;
    }

    const { data: suggestionEvent, error: suggestionError } = await supabase
      .from('copilot_events')
      .insert({
        session_id: id,
        user_id: userData.user.id,
        event_type: 'suggestion',
        payload: suggestionPayload,
      })
      .select('id, event_type, payload, created_at')
      .single();

    if (suggestionError) {
      logCopilotRouteError('/api/copilot/sessions/[id]/events', requestId, 'db_insert_suggestion_failed', {
        sessionId: id,
        code: suggestionError.code ?? null,
      });
      clearLatencyTracking(requestId);
      return internalError(requestId);
    }

    endStage(requestId, 'suggestion_persist');
    startStage(requestId, 'delivery');

    const timings = getLatencyTimings(requestId);
    const latencyMeta = timings ? latencyTimingsToMetadata(timings) : {};
    
    endStage(requestId, 'delivery');
    logLatencyMetrics(timings!);
    clearLatencyTracking(requestId);

    return NextResponse.json({ event: createdEvent, suggestion: suggestionEvent, ...latencyMeta }, { status: 201 });
  } catch (e) {
    logCopilotRouteError('/api/copilot/sessions/[id]/events', requestId, 'llm_suggestion_failed', {
      sessionId: id,
      errorType: e instanceof Error ? e.name : 'unknown',
    });

    const { data: fallbackSuggestion, error: fallbackError } = await supabase
      .from('copilot_events')
      .insert({
        session_id: id,
        user_id: userData.user.id,
        event_type: 'suggestion',
        payload: {
          category: 'system',
          text: 'Suggestion generation is temporarily unavailable. Try rephrasing the question in one short sentence.',
          based_on_event_id: createdEvent.id,
          mode,
          error: 'provider_unavailable',
        },
      })
      .select('id, event_type, payload, created_at')
      .single();

    if (fallbackError) {
      logCopilotRouteError('/api/copilot/sessions/[id]/events', requestId, 'db_insert_fallback_suggestion_failed', {
        sessionId: id,
        code: fallbackError.code ?? null,
      });
    }

    // Log latency metrics even on error path
    const timings = getLatencyTimings(requestId);
    if (timings) {
      logLatencyMetrics(timings, { error: 'llm_suggestion_failed' });
    }
    clearLatencyTracking(requestId);

    return NextResponse.json(
      {
        event: createdEvent,
        suggestion: fallbackSuggestion ?? null,
        requestId,
      },
      { status: 201 },
    );
  }
}
