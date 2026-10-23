import { NextResponse, type NextRequest } from 'next/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { LLMUnavailableError } from '@/lib/llmRouter';
import { buildContextPack } from '@/lib/copilot/contextPack';
import {
  PracticeSetupSchema,
  completeChat,
  parseQuestions,
  practiceModel,
  questionsRequest,
  type StoredPracticeSetup,
} from '@/lib/practice/practice';

/**
 * Starts a practice interview: the model writes the questions for the role
 * (and the résumé and job, when given), and they are saved in order.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  const rl = await rateLimit({ key: `practice:start:${userId}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) return jsonError(429, 'rate_limited');

  const parse = PracticeSetupSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());
  const setup = parse.data;

  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id, user_id, meta')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<{ id: string; user_id: string; meta: Record<string, unknown> | null }>();
  if (!session) return jsonError(404, 'not_found');

  const { count } = await supabase
    .from('interview_questions')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', id);
  if ((count ?? 0) > 0) return jsonError(409, 'already_started');

  let resume: { filename: string | null; parsed_text: string | null } | null = null;
  if (setup.resumeDocumentId) {
    const { data: doc } = await supabase
      .from('resume_documents')
      .select('id, user_id, filename, parsed_text')
      .eq('id', setup.resumeDocumentId)
      .maybeSingle<{ id: string; user_id: string; filename: string | null; parsed_text: string | null }>();
    if (!doc || doc.user_id !== userId) return jsonError(404, 'resume_not_found');
    if (!doc.parsed_text?.trim()) return jsonError(422, 'resume_not_parsed');
    resume = doc;
  }

  const pack = buildContextPack({
    resumeText: resume?.parsed_text,
    resumeFilename: resume?.filename,
    jobDescription: setup.jobDescription,
    company: setup.company,
    role: setup.role,
  });

  let reply: string;
  try {
    reply = await completeChat({
      model: practiceModel(),
      ...questionsRequest(setup, pack),
      maxTokens: 1_000,
      temperature: 0.7,
      timeoutMs: 45_000,
    });
  } catch (error) {
    if (error instanceof LLMUnavailableError) return jsonError(503, 'llm_unavailable');
    console.error('[practice] question generation failed', error instanceof Error ? error.message : error);
    return jsonError(502, 'questions_unavailable');
  }

  const questions = parseQuestions(reply, setup);
  if (questions.length === 0) return jsonError(502, 'questions_unavailable');

  const { data: saved, error: insertError } = await supabase
    .from('interview_questions')
    .insert(
      questions.map((question, index) => ({
        session_id: id,
        user_id: userId,
        question_text: question.text,
        question_type: question.type,
        difficulty: question.difficulty,
        order_index: index,
      })),
    )
    .select('id, question_text, question_type, difficulty, order_index, response_text, response_score, rubric, answered_at')
    .order('order_index', { ascending: true });
  if (insertError) return jsonError(500, 'db_error', insertError);

  const stored: StoredPracticeSetup = {
    role: setup.role,
    company: setup.company || undefined,
    type: setup.type,
    difficulty: setup.difficulty,
    count: setup.count,
    hasResume: Boolean(resume),
    hasJob: Boolean(setup.jobDescription?.trim()),
  };
  const title = setup.company ? `${setup.role} at ${setup.company}` : setup.role;
  const { error: updateError } = await supabase
    .from('interview_sessions')
    .update({
      title,
      status: 'in_progress',
      meta: { ...(session.meta ?? {}), practice: stored, ...(pack ? { context_pack: pack } : {}) },
    })
    .eq('id', id)
    .eq('user_id', userId);
  if (updateError) return jsonError(500, 'db_error', updateError);

  return NextResponse.json({ title, setup: stored, questions: saved ?? [] }, { status: 201 });
}
