import { NextResponse, type NextRequest } from 'next/server';
import { userModels } from '@/lib/answerModels';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { LLMUnavailableError } from '@/lib/llmRouter';
import { buildContextPack } from '@/lib/copilot/contextPack';
import {
  PracticeSetupSchema,
  completeChat,
  parseQuestions,
  questionsRequest,
  type GeneratedQuestion,
  type StoredPracticeSetup,
} from '@/lib/practice/practice';
import { loadBank, pickBankQuestions, saveToBank } from '@/lib/questionBank';
import { LOCALES } from '@/i18n/locales';
import { kitFor } from '@/lib/localizedEmail';

/**
 * Starts a practice interview: the model writes the questions for the role
 * (and the résumé and job, when given), and they are saved in order. With
 * `fromBank`, questions from the company's question bank come first and the
 * model writes only the rest. New questions join the user's private bank for
 * that company.
 */
/** The "Practice interview" title new interviews get, in any language. */
async function isDefaultPracticeTitle(title: string): Promise<boolean> {
  const defaults = await Promise.all(LOCALES.map(async (locale) => (await kitFor(locale)).t('NewPractice')('defaultTitle')));
  return defaults.includes(title);
}

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
    .select('id, user_id, meta, title')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<{ id: string; user_id: string; meta: Record<string, unknown> | null; title: string | null }>();
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

  const company = setup.company?.trim() ?? '';
  let fromBank: GeneratedQuestion[] = [];
  if (setup.fromBank && company) {
    try {
      fromBank = pickBankQuestions(await loadBank(supabase, company), setup.count).map((question) => ({
        ...question,
        difficulty: setup.difficulty,
      }));
    } catch (error) {
      // Without the bank the model writes them all.
      console.error('[practice] question bank unavailable', error instanceof Error ? error.message : error);
    }
  }

  const missing = setup.count - fromBank.length;
  let written: GeneratedQuestion[] = [];
  if (missing > 0) {
    let reply: string;
    try {
      reply = await completeChat({
        model: (await userModels(supabase, userId)).answer,
        ...questionsRequest(
          { ...setup, count: missing },
          pack,
          fromBank.map((question) => question.text),
        ),
        maxTokens: 1_000,
        temperature: 0.7,
        timeoutMs: 45_000,
      });
    } catch (error) {
      if (error instanceof LLMUnavailableError) return jsonError(503, 'llm_unavailable');
      console.error('[practice] question generation failed', error instanceof Error ? error.message : error);
      return jsonError(502, 'questions_unavailable');
    }
    written = parseQuestions(reply, { ...setup, count: missing });
    if (written.length === 0 && fromBank.length === 0) return jsonError(502, 'questions_unavailable');
  }
  const questions = [...fromBank, ...written];

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

  if (company && written.length > 0) {
    try {
      await saveToBank(supabase, userId, { company, role: setup.role, source: 'practice' }, written);
    } catch (error) {
      console.error('[practice] could not save to the question bank', error instanceof Error ? error.message : error);
    }
  }

  const stored: StoredPracticeSetup = {
    role: setup.role,
    company: setup.company || undefined,
    type: setup.type,
    difficulty: setup.difficulty,
    count: setup.count,
    fromBank: fromBank.length > 0 || undefined,
    followUps: setup.followUps,
    hasResume: Boolean(resume),
    hasJob: Boolean(setup.jobDescription?.trim()),
  };
  // Shown in lists and on Home, so in the language the interview was set up in. A title
  // the user already gave it (renamed before starting) is kept; only the default is replaced.
  const generated = setup.company
    ? (await kitFor(setup.locale ?? 'en')).t('PracticePages')('titleAt', { role: setup.role, company: setup.company })
    : setup.role;
  const current = typeof session.title === 'string' ? session.title.trim() : '';
  const title = current && !(await isDefaultPracticeTitle(current)) ? current : generated;
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
