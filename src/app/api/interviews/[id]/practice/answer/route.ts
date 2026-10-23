import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { LLMUnavailableError } from '@/lib/llmRouter';
import { readContextPack } from '@/lib/copilot/contextPack';
import {
  completeChat,
  feedbackRequest,
  parseFeedback,
  practiceModel,
  type StoredPracticeSetup,
} from '@/lib/practice/practice';

const BodySchema = z.object({
  questionId: z.string().uuid(),
  answer: z.string().trim().min(1).max(8_000),
});

/** Saves an answer to one practice question and returns the coach's feedback on it. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  const rl = await rateLimit({ key: `practice:answer:${userId}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return jsonError(429, 'rate_limited');

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());
  const { questionId, answer } = parse.data;

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id, meta')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<{ id: string; meta: Record<string, unknown> | null }>();
  if (!session) return jsonError(404, 'not_found');

  const { data: question } = await supabase
    .from('interview_questions')
    .select('id, session_id, question_text, question_type, difficulty')
    .eq('id', questionId)
    .eq('session_id', id)
    .maybeSingle<{ id: string; session_id: string; question_text: string; question_type: string; difficulty: string }>();
  if (!question) return jsonError(404, 'question_not_found');

  // Keep the answer even if the feedback fails, so nothing typed is lost.
  const answeredAt = new Date().toISOString();
  const { error: saveError } = await supabase
    .from('interview_questions')
    .update({ response_text: answer, answered_at: answeredAt })
    .eq('id', questionId)
    .eq('session_id', id);
  if (saveError) return jsonError(500, 'db_error', saveError);

  const practice = (session.meta?.practice ?? {}) as Partial<StoredPracticeSetup>;
  let reply: string;
  try {
    reply = await completeChat({
      model: practiceModel(),
      ...feedbackRequest(
        { text: question.question_text, type: question.question_type, difficulty: question.difficulty },
        answer,
        { role: practice.role ?? 'the role', company: practice.company },
        readContextPack(session.meta),
      ),
      maxTokens: 700,
      temperature: 0.3,
      timeoutMs: 45_000,
    });
  } catch (error) {
    if (error instanceof LLMUnavailableError) return jsonError(503, 'llm_unavailable');
    console.error('[practice] feedback failed', error instanceof Error ? error.message : error);
    return jsonError(502, 'feedback_unavailable');
  }

  const feedback = parseFeedback(reply);
  if (!feedback) return jsonError(502, 'feedback_unavailable');

  const { error: feedbackError } = await supabase
    .from('interview_questions')
    .update({ response_score: feedback.score * 10, rubric: { feedback } })
    .eq('id', questionId)
    .eq('session_id', id);
  if (feedbackError) return jsonError(500, 'db_error', feedbackError);

  return NextResponse.json({ questionId, answeredAt, feedback });
}
