import { after, NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { releaseQuota, reserveQuota } from '@/lib/quota';
import { isProviderConfigured, providerForModel } from '@/lib/llmRouter';
import { completeChat } from '@/lib/practice/practice';
import { userModels } from '@/lib/answerModels';
import { parseTailoredResume, tailoredResumeRequest } from '@/lib/tailoredResume';
import { notify } from '@/lib/notify';

/**
 * Résumé → "Write a tailored version". Creates a generation row, answers 202
 * straight away, and writes the résumé in the background; the row goes from
 * "processing" to "completed" (or "failed"), and the user gets a notification.
 * Each tailored version counts as one résumé review: taken before the 202 (so
 * parallel requests can't all pass the same check) and handed back if writing fails.
 */

const BodySchema = z.object({
  documentId: z.string().uuid(),
  jobDescription: z.string().trim().min(50, 'Paste the job description (at least 50 characters).').max(20_000),
});

const MODEL_TIMEOUT_MS = 90_000;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  const rl = await rateLimit({ key: `resume_generate:post:${userId}`, limit: 5, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());
  const { documentId, jobDescription } = parse.data;

  const { data: doc } = await supabase
    .from('resume_documents')
    .select('id, user_id, filename, parsed_text')
    .eq('id', documentId)
    .maybeSingle<{ id: string; user_id: string; filename: string | null; parsed_text: string | null }>();
  if (!doc || doc.user_id !== userId) return jsonError(404, 'resume_not_found');
  if (!doc.parsed_text?.trim()) return jsonError(422, 'resume_not_parsed');

  const model = (await userModels(supabase, userId)).answer;
  const provider = providerForModel(model);
  if (!provider || !isProviderConfigured(provider)) return jsonError(503, 'llm_unavailable');

  const reservation = await reserveQuota(userId, 'resume_deep_reviews');
  if (!reservation.ok) {
    if (reservation.error === 'quota_unavailable') return jsonError(503, 'quota_unavailable');
    return jsonError(403, 'quota_exceeded', { type: 'resume_deep_reviews', used: reservation.used, limit: reservation.limit });
  }
  const { reservedAt } = reservation;

  const admin = createAdminClient();
  const { data: generation, error } = await admin
    .from('resume_generations')
    .insert({
      user_id: userId,
      document_id: documentId,
      status: 'processing',
      job_description: jobDescription,
      input: { kind: 'tailored_resume', model },
      output: {},
    })
    .select('id, status, created_at, input, output, document_id')
    .single();
  if (error || !generation) {
    await releaseQuota(userId, 'resume_deep_reviews', reservedAt);
    return jsonError(500, 'db_error', error);
  }

  after(async () => {
    let saved = false;
    try {
      const reply = await completeChat({
        model,
        ...tailoredResumeRequest({ resumeText: doc.parsed_text ?? '', jobDescription }),
        temperature: 0.3,
        maxTokens: 3_000,
        timeoutMs: MODEL_TIMEOUT_MS,
      });
      const tailored = parseTailoredResume(reply);
      if (!tailored) throw new Error('The model returned no résumé');

      const { error: saveError } = await admin
        .from('resume_generations')
        .update({
          status: 'completed',
          output: tailored,
          keyword_matches: tailored.keywords,
          updated_at: new Date().toISOString(),
        })
        .eq('id', generation.id);
      // Not saved: fall through to "failed", which also hands the quota back.
      if (saveError) throw new Error(`Could not save the résumé: ${saveError.message}`);
      saved = true;
      await notify(userId, {
        type: 'ai_suggestion',
        title: 'Your tailored résumé is ready',
        message: tailored.target
          ? `Tailored for ${tailored.target}. Open it to copy or download.`
          : 'Open it to copy or download.',
        url: '/resume',
        data: { generationId: generation.id },
        i18n: tailored.target
          ? { key: 'resumeReadyFor', params: { target: tailored.target } }
          : { key: 'resumeReady' },
      });
    } catch (e) {
      console.error('[resume] tailored version failed', { generationId: generation.id, error: e instanceof Error ? e.message : e });
      // Written and saved: it counts, even if the notification didn't go out.
      if (saved) return;
      await releaseQuota(userId, 'resume_deep_reviews', reservedAt);
      await admin
        .from('resume_generations')
        .update({ status: 'failed', output: { error: 'generation_failed' }, updated_at: new Date().toISOString() })
        .eq('id', generation.id);
    }
  });

  return NextResponse.json({ generation }, { status: 202 });
}
