import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import { loadActiveCopilotSession } from '@/lib/copilot/activeSession';
import { gateModel } from '@/lib/copilot/gateModel';
import { QUESTION_CATEGORIES } from '@/lib/copilot/questionGate';
import { providerForModel } from '@/lib/llmRouter';
import { completeChat, extractJsonObject } from '@/lib/practice/practice';

/**
 * POST /api/copilot/sessions/[id]/gate — fast yes/no: should the candidate get
 * an answer for this interviewer line? Only called for lines the heuristic
 * gate can't decide; the client gives it ~600 ms and falls back on timeout.
 * Uses whichever provider has a key (see gateModel); with none, it answers
 * 503 and the heuristic decides.
 */

interface Params {
  params: Promise<{ id: string }>;
}

const BodySchema = z.object({
  text: z.string().trim().min(1).max(1000),
});

const VerdictSchema = z.object({
  answer: z.boolean(),
  category: z.enum(QUESTION_CATEGORIES as [string, ...string[]]).catch('other'),
});

const MODEL_TIMEOUT_MS = 1_500;
const MAX_TOKENS = 30;

const SYSTEM_PROMPT = [
  'You sit in on a job interview and see one thing the interviewer just said.',
  'Decide whether it asks the candidate for an answer that is worth preparing:',
  'a question, a prompt such as "tell me about..." or "walk me through...", or a coding or design task.',
  'Small talk, call logistics ("can you hear me"), checks like "does that make sense", acknowledgements',
  'and the interviewer describing the company or role are not.',
  'Reply with JSON only: {"answer": true|false, "category": "behavioral"|"technical"|"coding"|"system_design"|"other"}.',
].join(' ');

/** The model's reply, as text. OpenAI keeps its JSON mode in one short request; other providers go through the shared router. */
async function classify(model: string, line: string, signal: AbortSignal): Promise<string> {
  if (providerForModel(model) === 'openai') {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: line },
        ],
      },
      { signal, timeout: MODEL_TIMEOUT_MS, maxRetries: 0 },
    );
    return completion.choices[0]?.message?.content ?? '';
  }
  return completeChat({
    model,
    system: [SYSTEM_PROMPT],
    messages: [{ role: 'user', content: line }],
    temperature: 0,
    maxTokens: MAX_TOKENS,
    signal,
    timeoutMs: MODEL_TIMEOUT_MS,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipRl = await rateLimit({ key: `copilot:gate:ip:${ip}`, limit: 120, windowMs: 60_000 });
  if (!ipRl.ok) return jsonError(429, 'rate_limited');

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userRl = await rateLimit({ key: `copilot:gate:user:${userData.user.id}`, limit: 60, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  const { error: sessionError } = await loadActiveCopilotSession(supabase, id, userData.user.id);
  if (sessionError) return sessionError;

  const cleaned = sanitizeCopilotText(parse.data.text);
  if (cleaned.hasPromptInjection) return NextResponse.json({ answer: false, category: 'other' });

  const model = gateModel();
  if (!model) return jsonError(503, 'classifier_unavailable');

  try {
    const reply = await classify(model, cleaned.sanitized, req.signal);
    const verdict = VerdictSchema.safeParse(extractJsonObject(reply));
    if (!verdict.success) return jsonError(502, 'classifier_failed');
    return NextResponse.json(verdict.data);
  } catch (e) {
    console.error('[copilot]', { route: '/api/copilot/sessions/[id]/gate', errorClass: 'classifier_failed', model, name: e instanceof Error ? e.name : 'unknown' });
    return jsonError(502, 'classifier_failed');
  }
}
