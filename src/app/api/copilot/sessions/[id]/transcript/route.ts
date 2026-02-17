import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { llmProvider, requireEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import { isSessionHeartbeatExpired, withHeartbeatMetadata } from '@/lib/copilotSession';
import { buildSuggestionPrompt, parseSuggestionContent } from '@/lib/copilotSuggestion';
import { copilotOk, copilotRateLimited, sessionExpiredResponse } from '@/lib/copilotApiResponse';

interface Params {
  params: Promise<{ id: string }>;
}

type EventPayload = Record<string, unknown>;

type CopilotEventRow = {
  id: string;
  event_type: string;
  payload: EventPayload;
  created_at: string;
};

const ChunkSchema = z.object({
  speaker: z.enum(['interviewer', 'candidate', 'system']).default('interviewer'),
  text: z.string().trim().min(1).max(4000),
  isFinal: z.boolean().default(true),
  interimId: z.string().trim().min(1).max(120).optional(),
  clientTimestamp: z.string().datetime().optional(),
  autoSuggest: z.boolean().optional(),
});

const BodySchema = z.object({
  chunks: z.array(ChunkSchema).min(1).max(30),
});

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

function logCopilotRouteError(route: string, requestId: string, errorClass: string, meta?: Record<string, unknown>) {
  console.error('[copilot]', { route, requestId, errorClass, ...(meta ?? {}) });
}

function internalError(requestId: string) {
  return jsonError(500, 'internal_error', { requestId });
}

function matchesChunk(event: CopilotEventRow, chunk: z.infer<typeof ChunkSchema>, text: string) {
  if (event.event_type !== 'transcript') return false;
  const payload = event.payload;

  return (
    payload.speaker === chunk.speaker &&
    payload.text === text &&
    payload.transcript_kind === (chunk.isFinal ? 'final' : 'interim') &&
    payload.interim_id === (chunk.interimId ?? null)
  );
}

export async function POST(req: NextRequest, { params }: Params) {
  const requestId = getRequestId(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const anonRl = await rateLimit({ key: `copilot:transcript:anon:${ip}`, limit: 120, windowMs: 60_000 });
  if (!anonRl.ok) return copilotRateLimited();

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const userRl = await rateLimit({ key: `copilot:transcript:user:${userId}`, limit: 240, windowMs: 60_000 });
  if (!userRl.ok) return copilotRateLimited();

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, started_at, metadata')
    .eq('id', id)
    .single<{ id: string; user_id: string; status: string; started_at: string; metadata: Record<string, unknown> | null }>();

  if (sessionError || !session) return jsonError(404, 'session_not_found');
  if (session.user_id !== userId) return jsonError(404, 'session_not_found');

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
      .eq('user_id', userId)
      .eq('status', 'active');

    return sessionExpiredResponse(session, nowIso);
  }

  if (session.status !== 'active') return jsonError(409, 'session_not_active');

  const mode = typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';
  const createdEvents: Array<Record<string, unknown>> = [];
  const createdSuggestions: Array<Record<string, unknown>> = [];
  let rejected = 0;

  const { data: recentTranscriptRows } = await supabase
    .from('copilot_events')
    .select('id, event_type, payload, created_at')
    .eq('session_id', id)
    .eq('event_type', 'transcript')
    .order('created_at', { ascending: false })
    .limit(40)
    .returns<CopilotEventRow[]>();

  const recentTranscriptEvents = (recentTranscriptRows ?? []).slice();

  for (const chunk of parse.data.chunks) {
    const cleanedInput = sanitizeCopilotText(chunk.text);

    if (!cleanedInput.sanitized.trim()) {
      rejected += 1;
      continue;
    }

    const duplicateEvent = chunk.interimId
      ? recentTranscriptEvents.find((event) => matchesChunk(event, chunk, cleanedInput.sanitized))
      : null;

    if (duplicateEvent) {
      createdEvents.push(duplicateEvent);
      continue;
    }

    const payload: EventPayload = {
      speaker: chunk.speaker,
      text: cleanedInput.sanitized,
      mode,
      transcript_kind: chunk.isFinal ? 'final' : 'interim',
      interim_id: chunk.interimId ?? null,
      client_timestamp: chunk.clientTimestamp ?? null,
      security: {
        redactions: cleanedInput.redactions,
        prompt_injection: cleanedInput.hasPromptInjection,
      },
    };

    const { data: createdEvent, error: insertError } = await supabase
      .from('copilot_events')
      .insert({
        session_id: id,
        user_id: userId,
        event_type: 'transcript',
        payload,
      })
      .select('id, event_type, payload, created_at')
      .single();

    if (insertError || !createdEvent) {
      logCopilotRouteError('/api/copilot/sessions/[id]/transcript', requestId, 'db_insert_transcript_failed', {
        sessionId: id,
        code: insertError?.code ?? null,
      });
      return internalError(requestId);
    }

    createdEvents.push(createdEvent);
    recentTranscriptEvents.unshift(createdEvent as CopilotEventRow);

    const shouldSuggest =
      (chunk.autoSuggest ?? true) &&
      chunk.isFinal &&
      chunk.speaker === 'interviewer' &&
      !cleanedInput.hasPromptInjection;

    if (!shouldSuggest) continue;

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

    try {
      if (llmProvider() !== 'openai') return jsonError(400, 'unsupported_provider');

      const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: buildSuggestionPrompt({
          mode,
          transcriptText: transcriptText || `${chunk.speaker}: ${cleanedInput.sanitized}`,
          latestQuestion: cleanedInput.sanitized,
        }),
      });

      const content = completion.choices[0]?.message?.content ?? '{}';
      const parsedSuggestion = parseSuggestionContent(content, mode);

      const suggestionPayload: EventPayload = {
        category: 'answer',
        text: parsedSuggestion.shortAnswer,
        based_on_event_id: createdEvent.id,
        mode,
        structured: parsedSuggestion.structured,
      };

      if (parsedSuggestion.talkingPoints.length > 0) suggestionPayload.talking_points = parsedSuggestion.talkingPoints;
      if (parsedSuggestion.followUp) suggestionPayload.follow_up = parsedSuggestion.followUp;
      if (parsedSuggestion.complexity) suggestionPayload.complexity = parsedSuggestion.complexity;
      if (parsedSuggestion.edgeCases?.length) suggestionPayload.edge_cases = parsedSuggestion.edgeCases;
      if (parsedSuggestion.checklist?.length) suggestionPayload.checklist = parsedSuggestion.checklist;

      const { data: suggestionEvent, error: suggestionError } = await supabase
        .from('copilot_events')
        .insert({
          session_id: id,
          user_id: userId,
          event_type: 'suggestion',
          payload: suggestionPayload,
        })
        .select('id, event_type, payload, created_at')
        .single();

      if (suggestionError || !suggestionEvent) {
        logCopilotRouteError('/api/copilot/sessions/[id]/transcript', requestId, 'db_insert_suggestion_failed', {
          sessionId: id,
          code: suggestionError?.code ?? null,
        });
        return internalError(requestId);
      }

      createdSuggestions.push(suggestionEvent);
    } catch (e) {
      logCopilotRouteError('/api/copilot/sessions/[id]/transcript', requestId, 'llm_suggestion_failed', {
        sessionId: id,
        errorType: e instanceof Error ? e.name : 'unknown',
      });

      const { data: fallbackSuggestion } = await supabase
        .from('copilot_events')
        .insert({
          session_id: id,
          user_id: userId,
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

      if (fallbackSuggestion) createdSuggestions.push(fallbackSuggestion);
    }
  }

  if (createdEvents.length === 0) {
    return jsonError(400, 'no_valid_chunks', { accepted: 0, rejected });
  }

  const payload = {
    events: createdEvents,
    suggestions: createdSuggestions,
    accepted: createdEvents.length,
    rejected,
  };

  return copilotOk(payload, 201);
}
