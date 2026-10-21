import { createHash } from 'node:crypto';
import { after, NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import { getCopilotQuotaSnapshot, getElapsedUsage } from '@/lib/copilot';
import { isProviderConfigured, providerForModel } from '@/lib/llmRouter';
import { loadActiveCopilotSession, sessionMode } from '@/lib/copilot/activeSession';
import { screenSystemBlocks, screenUserParts, type TranscriptLine } from '@/lib/copilot/answerPrompt';
import { readContextPack } from '@/lib/copilot/contextPack';
import { eventStreamResponse, replayAnswerEvents, streamAnswerEvents } from '@/lib/copilot/answerStream';

/**
 * POST /api/copilot/sessions/[id]/screen — "Solve screen" (build plan Step 9).
 * Takes one frame of the shared tab or screen and streams an answer in the
 * same server-sent events format as the answer route.
 *
 * Frames are hashed (SHA-256). A frame already answered in this session gets
 * the saved answer back instead of another model call. Frames themselves are
 * never stored, only their hash with the answer.
 */

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ id: string }>;
}

/** A 1600 px-wide JPEG of code is usually 150–500 KB. */
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64 * 1024;

const BodySchema = z.object({
  /** JPEG or PNG bytes, base64 (no data: prefix). */
  image: z.string().min(16).max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+=*$/),
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

const MAX_ANSWER_TOKENS = 1200;
const MODEL_TIMEOUT_MS = 45_000;

/** A vision-capable model; the coding model when one is set. */
function screenModel(): string {
  return env.COPILOT_CODING_MODEL ?? env.COPILOT_ANSWER_MODEL ?? 'gpt-4o-mini';
}

function imageType(bytes: Buffer): 'image/jpeg' | 'image/png' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  return null;
}

function getRequestId(req: NextRequest) {
  return req.headers.get('x-request-id') || crypto.randomUUID();
}

function logScreenError(requestId: string, errorClass: string, meta?: Record<string, unknown>) {
  console.error('[copilot]', { route: '/api/copilot/sessions/[id]/screen', requestId, errorClass, ...(meta ?? {}) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const receivedAt = Date.now();
  const requestId = getRequestId(req);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipRl = await rateLimit({ key: `copilot:screen:ip:${ip}`, limit: 30, windowMs: 60_000 });
  if (!ipRl.ok) return jsonError(429, 'rate_limited');

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return jsonError(413, 'image_too_large');
  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const bytes = Buffer.from(parse.data.image, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) return jsonError(413, 'image_too_large');
  const mediaType = imageType(bytes);
  if (!mediaType) return jsonError(400, 'invalid_image');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  // Each frame is a vision call: fewer than spoken answers.
  const userRl = await rateLimit({ key: `copilot:screen:user:${userId}`, limit: 10, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  const [loaded, quota, previous] = await Promise.all([
    loadActiveCopilotSession(supabase, id, userId),
    getCopilotQuotaSnapshot(userId).catch(() => null),
    supabase
      .from('copilot_events')
      .select('payload')
      .eq('session_id', id)
      .eq('event_type', 'suggestion')
      .eq('payload->>screen_sha256', sha256)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (loaded.error) return loaded.error;
  const { session } = loaded;
  if (!quota) return jsonError(503, 'quota_unavailable');
  const remaining = Math.min(quota.monthly.remaining, quota.daily.remaining, quota.perSession.remaining);
  if (getElapsedUsage(session.started_at).elapsedMinutes > remaining) return jsonError(403, 'quota_exceeded');

  const saved = previous.data?.payload as { text?: unknown; model?: unknown } | undefined;
  if (typeof saved?.text === 'string' && saved.text.trim()) {
    return eventStreamResponse(
      replayAnswerEvents({ text: saved.text, model: typeof saved.model === 'string' ? saved.model : 'saved', receivedAt }),
    );
  }

  const model = screenModel();
  const provider = providerForModel(model);
  if (!provider || !isProviderConfigured(provider)) return jsonError(503, 'answers_unavailable');

  const recentTranscript: TranscriptLine[] = parse.data.recentTranscript
    .map((line) => ({ speaker: line.speaker, cleaned: sanitizeCopilotText(line.text) }))
    .filter(({ cleaned }) => !cleaned.hasPromptInjection && cleaned.sanitized.trim())
    .map(({ speaker, cleaned }) => ({ speaker, text: cleaned.sanitized }));

  const mode = sessionMode(session);
  const { body, result } = streamAnswerEvents({
    chat: {
      model,
      system: screenSystemBlocks({
        contextPack: readContextPack(session.metadata),
        noFullCode: session.metadata?.noFullCodeMode === true,
      }),
      messages: [{ role: 'user', content: screenUserParts({ recentTranscript, image: { mediaType, data: parse.data.image } }) }],
      maxTokens: MAX_ANSWER_TOKENS,
      temperature: 0.2,
      timeoutMs: MODEL_TIMEOUT_MS,
    },
    receivedAt,
    requestId,
    signal: req.signal,
    onError: (e) =>
      logScreenError(requestId, 'llm_screen_failed', { sessionId: id, model, name: e instanceof Error ? e.name : 'unknown' }),
  });

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
        question: 'Solve screen',
        question_category: 'coding',
        trigger: 'manual',
        source: 'screen',
        screen_sha256: sha256,
        mode,
        model,
        ttft_ms: answer.ttftMs,
        total_ms: answer.totalMs,
      },
    });
    if (error) logScreenError(requestId, 'db_insert_answer_failed', { sessionId: id, code: error.code ?? null });
  });

  return eventStreamResponse(body);
}
