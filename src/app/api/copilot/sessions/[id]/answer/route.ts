import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { env, llmProvider } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import { buildSuggestionPrompt, parseSuggestionContent, suggestionEventPayload } from '@/lib/copilotSuggestion';
import { loadActiveCopilotSession, sessionMode } from '@/lib/copilot/activeSession';
import { QUESTION_CATEGORIES } from '@/lib/copilot/questionGate';

/**
 * POST /api/copilot/sessions/[id]/answer — answers one interviewer question
 * picked by the question gate or by Answer now.
 *
 * Transcript lines are saved separately, so a superseded question only needs
 * the client to abort this request: the model call is cancelled with it and
 * nothing is saved. Step 4 turns this into a streaming response.
 */

interface Params {
  params: Promise<{ id: string }>;
}

const BodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  category: z.enum(QUESTION_CATEGORIES as [string, ...string[]]).default('other'),
  trigger: z.enum(['gate', 'manual']).default('gate'),
});

const MODEL_TIMEOUT_MS = 20_000;

type EventRow = { id: string; event_type: string; payload: Record<string, unknown>; created_at: string };

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

function logAnswerError(requestId: string, errorClass: string, meta?: Record<string, unknown>) {
  console.error('[copilot]', { route: '/api/copilot/sessions/[id]/answer', requestId, errorClass, ...(meta ?? {}) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const requestId = getRequestId(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipRl = await rateLimit({ key: `copilot:answer:ip:${ip}`, limit: 60, windowMs: 60_000 });
  if (!ipRl.ok) return jsonError(429, 'rate_limited');

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  // Supersedes can come in bursts, but each one aborts the last.
  const userRl = await rateLimit({ key: `copilot:answer:user:${userId}`, limit: 30, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  const { session, error: sessionError } = await loadActiveCopilotSession(supabase, id, userId);
  if (sessionError) return sessionError;

  const question = sanitizeCopilotText(parse.data.question);
  if (question.hasPromptInjection) return jsonError(422, 'question_blocked');

  if (llmProvider() !== 'openai' || !env.OPENAI_API_KEY) return jsonError(503, 'answers_unavailable');

  const { data: transcriptRows } = await supabase
    .from('copilot_events')
    .select('id, event_type, payload, created_at')
    .eq('session_id', id)
    .eq('event_type', 'transcript')
    .order('created_at', { ascending: false })
    .limit(16)
    .returns<EventRow[]>();

  const transcriptText = (transcriptRows ?? [])
    .slice()
    .reverse()
    .map((row) => `${String(row.payload.speaker ?? 'unknown')}: ${String(row.payload.text ?? '')}`)
    .join('\n');

  const mode = sessionMode(session);

  let content: string;
  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create(
      {
        model: env.COPILOT_ANSWER_MODEL ?? 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: buildSuggestionPrompt({
          mode,
          transcriptText: transcriptText || `interviewer: ${question.sanitized}`,
          latestQuestion: question.sanitized,
        }),
      },
      { signal: req.signal, timeout: MODEL_TIMEOUT_MS, maxRetries: 0 },
    );
    content = completion.choices[0]?.message?.content ?? '{}';
  } catch (e) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    logAnswerError(requestId, 'llm_answer_failed', { sessionId: id, name: e instanceof Error ? e.name : 'unknown' });
    return jsonError(502, 'answer_failed', { requestId });
  }

  // Superseded while the model was finishing: don't save a stale answer.
  if (req.signal.aborted) return new NextResponse(null, { status: 499 });

  const parsed = parseSuggestionContent(content, mode);
  const { data: suggestion, error: insertError } = await supabase
    .from('copilot_events')
    .insert({
      session_id: id,
      user_id: userId,
      event_type: 'suggestion',
      payload: suggestionEventPayload(parsed, {
        mode,
        question: question.sanitized,
        question_category: parse.data.category,
        trigger: parse.data.trigger,
      }),
    })
    .select('id, event_type, payload, created_at')
    .single();

  if (insertError || !suggestion) {
    logAnswerError(requestId, 'db_insert_suggestion_failed', { sessionId: id, code: insertError?.code ?? null });
    return jsonError(500, 'internal_error', { requestId });
  }

  return NextResponse.json({ suggestion }, { status: 201 });
}
