import { after, NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import { getCopilotQuotaSnapshot, getElapsedUsage } from '@/lib/copilot';
import { isProviderConfigured, providerForModel } from '@/lib/llmRouter';
import { eventStreamResponse, streamAnswerEvents } from '@/lib/copilot/answerStream';
import { loadActiveCopilotSession, sessionMode } from '@/lib/copilot/activeSession';
import { answerSystemBlocks, answerUserMessage, type TranscriptLine } from '@/lib/copilot/answerPrompt';
import { readContextPack } from '@/lib/copilot/contextPack';
import { QUESTION_CATEGORIES, type QuestionCategory } from '@/lib/copilot/questionGate';

/**
 * POST /api/copilot/sessions/[id]/answer — streams an answer to one
 * interviewer question as server-sent events:
 *
 *   event: token  data: {"text":"…"}         (repeated)
 *   event: done   data: {"model","ttftMs","totalMs"}
 *   event: error  data: {"error":"answer_failed"}
 *
 * A newer question aborts this request; the model call is cancelled with it
 * and nothing is saved. A finished answer is saved after the response, off
 * the hot path, and reaches the history list through the session stream.
 */

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ id: string }>;
}

const BodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
  category: z.enum(QUESTION_CATEGORIES as [QuestionCategory, ...QuestionCategory[]]).default('other'),
  trigger: z.enum(['gate', 'manual']).default('gate'),
  recentTranscript: z
    .array(
      z.object({
        speaker: z.enum(['interviewer', 'candidate']),
        text: z.string().trim().min(1).max(1000),
      }),
    )
    .max(20)
    .default([]),
});

const MAX_ANSWER_TOKENS = 700;
const MODEL_TIMEOUT_MS = 30_000;

/** Fast model for most questions; an optional stronger one for coding and design. */
function answerModel(category: QuestionCategory): string {
  const fast = env.COPILOT_ANSWER_MODEL ?? 'gpt-4o-mini';
  return category === 'coding' || category === 'system_design' ? (env.COPILOT_CODING_MODEL ?? fast) : fast;
}

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

function logAnswerError(requestId: string, errorClass: string, meta?: Record<string, unknown>) {
  console.error('[copilot]', { route: '/api/copilot/sessions/[id]/answer', requestId, errorClass, ...(meta ?? {}) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const receivedAt = Date.now();
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

  // Supersedes come in bursts, but each one aborts the last.
  const userRl = await rateLimit({ key: `copilot:answer:user:${userId}`, limit: 30, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  // In parallel: both sit between the question and the first token.
  const [loaded, quota] = await Promise.all([
    loadActiveCopilotSession(supabase, id, userId),
    getCopilotQuotaSnapshot(userId).catch(() => null),
  ]);
  if (loaded.error) return loaded.error;
  const { session } = loaded;
  if (!quota) return jsonError(503, 'quota_unavailable');
  const remaining = Math.min(quota.monthly.remaining, quota.daily.remaining, quota.perSession.remaining);
  if (getElapsedUsage(session.started_at).elapsedMinutes > remaining) return jsonError(403, 'quota_exceeded');

  const question = sanitizeCopilotText(parse.data.question);
  if (question.hasPromptInjection) return jsonError(422, 'question_blocked');

  const category = parse.data.category;
  const model = answerModel(category);
  const provider = providerForModel(model);
  if (!provider || !isProviderConfigured(provider)) return jsonError(503, 'answers_unavailable');

  const recentTranscript: TranscriptLine[] = parse.data.recentTranscript
    .map((line) => ({ speaker: line.speaker, cleaned: sanitizeCopilotText(line.text) }))
    .filter(({ cleaned }) => !cleaned.hasPromptInjection && cleaned.sanitized.trim())
    .map(({ speaker, cleaned }) => ({ speaker, text: cleaned.sanitized }));

  const mode = sessionMode(session);
  const system = answerSystemBlocks({
    mode,
    contextPack: readContextPack(session.metadata),
    noFullCode: session.metadata?.noFullCodeMode === true,
  });
  const userMessage = answerUserMessage({ question: question.sanitized, category, recentTranscript });

  const { body, result } = streamAnswerEvents({
    chat: {
      model,
      system,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: MAX_ANSWER_TOKENS,
      temperature: 0.4,
      timeoutMs: MODEL_TIMEOUT_MS,
    },
    receivedAt,
    requestId,
    signal: req.signal,
    onError: (e) =>
      logAnswerError(requestId, 'llm_answer_failed', { sessionId: id, model, name: e instanceof Error ? e.name : 'unknown' }),
  });

  // Saved once the response is over; a superseded or failed answer is not.
  after(async () => {
    const answer = result();
    if (!answer) return;
    const { error } = await supabase.from('copilot_events').insert({
      session_id: id,
      user_id: userId,
      event_type: 'suggestion',
      payload: {
        category: 'answer',
        text: answer.text,
        format: 'markdown',
        question: question.sanitized,
        question_category: category,
        trigger: parse.data.trigger,
        mode,
        model,
        ttft_ms: answer.ttftMs,
        total_ms: answer.totalMs,
      },
    });
    if (error) logAnswerError(requestId, 'db_insert_answer_failed', { sessionId: id, code: error.code ?? null });
  });

  return eventStreamResponse(body);
}
