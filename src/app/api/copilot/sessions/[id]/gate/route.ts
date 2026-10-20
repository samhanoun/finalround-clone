import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { env, llmProvider } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';
import { loadActiveCopilotSession } from '@/lib/copilot/activeSession';
import { QUESTION_CATEGORIES } from '@/lib/copilot/questionGate';

/**
 * POST /api/copilot/sessions/[id]/gate — fast yes/no: should the candidate get
 * an answer for this interviewer line? Only called for lines the heuristic
 * gate can't decide; the client gives it ~600 ms and falls back on timeout.
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

const SYSTEM_PROMPT = [
  'You sit in on a job interview and see one thing the interviewer just said.',
  'Decide whether it asks the candidate for an answer that is worth preparing:',
  'a question, a prompt such as "tell me about..." or "walk me through...", or a coding or design task.',
  'Small talk, call logistics ("can you hear me"), checks like "does that make sense", acknowledgements',
  'and the interviewer describing the company or role are not.',
  'Reply with JSON only: {"answer": true|false, "category": "behavioral"|"technical"|"coding"|"system_design"|"other"}.',
].join(' ');

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

  if (llmProvider() !== 'openai' || !env.OPENAI_API_KEY) return jsonError(503, 'classifier_unavailable');

  try {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create(
      {
        model: env.COPILOT_GATE_MODEL ?? 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 30,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: cleaned.sanitized },
        ],
      },
      { signal: req.signal, timeout: MODEL_TIMEOUT_MS, maxRetries: 0 },
    );
    const verdict = VerdictSchema.safeParse(JSON.parse(completion.choices[0]?.message?.content ?? 'null'));
    if (!verdict.success) return jsonError(502, 'classifier_failed');
    return NextResponse.json(verdict.data);
  } catch (e) {
    console.error('[copilot]', { route: '/api/copilot/sessions/[id]/gate', errorClass: 'classifier_failed', name: e instanceof Error ? e.name : 'unknown' });
    return jsonError(502, 'classifier_failed');
  }
}
