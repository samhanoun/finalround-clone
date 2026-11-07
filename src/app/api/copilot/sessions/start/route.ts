import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { endOpenCopilotSessions, SESSION_COLUMNS, type EndableCopilotSession } from '@/lib/copilot/endSession';
import { rateLimit } from '@/lib/rateLimit';
import { getCopilotQuotaSnapshot } from '@/lib/copilot';
import { withHeartbeatMetadata } from '@/lib/copilotSession';
import { grantConsentMetadata } from '@/lib/copilotConsent';
import { buildContextPack } from '@/lib/copilot/contextPack';
import { isAllowedModel, userModels } from '@/lib/answerModels';
import { CODING_LANGUAGES, SPOKEN_LANGUAGES } from '@/lib/copilot/sessionOptions';
import { loadGoalSources, loadMemories, loadPlaybook } from '@/lib/goals';

const BodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  interviewSessionId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Interview context for answers (Step 4): built into metadata.context_pack.
  resumeDocumentId: z.string().uuid().optional(),
  jobDescription: z.string().max(20_000).optional(),
  company: z.string().max(200).optional(),
  role: z.string().max(200).optional(),
  // Per-session choices (the setup step); the user's settings otherwise.
  answerModel: z.string().min(1).max(100).optional(),
  language: z.enum(SPOKEN_LANGUAGES).optional(),
  codingLanguage: z.enum(CODING_LANGUAGES).optional(),
  /** Phone / in-person mode: one microphone for both people. */
  singleMic: z.boolean().optional(),
  /** A saved goal: its résumé, job, materials and playbook (fields above override its company, role and job). */
  goalId: z.string().uuid().optional(),
  /** A playbook for a session without a goal (or instead of the goal's). */
  playbookId: z.string().uuid().optional(),
});

/** Set only by the server, never taken from the client's metadata. */
const SERVER_METADATA_KEYS = new Set(['context_pack', 'models', 'stt', 'codingLanguage', 'goal_id']);

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:start:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;

  // A session left open (tab crashed, Stop never sent) is charged now, before
  // the quota check, so abandoning sessions can't dodge the minutes limit.
  const { data: openSessions, error: openError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, started_at, metadata')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (openError) return jsonError(500, 'db_error', openError);
  const { error: closeError } = await endOpenCopilotSessions((openSessions ?? []) as EndableCopilotSession[]);
  if (closeError) return jsonError(500, 'db_error', closeError);

  const quota = await getCopilotQuotaSnapshot(userId);

  if (!quota.monthly.allowed || !quota.daily.allowed || !quota.perSession.allowed) {
    return jsonError(403, 'quota_exceeded', {
      copilot_minutes: quota.monthly,
      copilot_daily_minutes: quota.daily,
      copilot_session_minutes: quota.perSession,
    });
  }

  const goal = parse.data.goalId ? await loadGoalSources(supabase, userId, parse.data.goalId) : null;
  if (parse.data.goalId && !goal) return jsonError(404, 'goal_not_found');

  let resume: { filename: string | null; parsed_text: string | null } | null = goal?.resume?.parsed_text?.trim() ? goal.resume : null;
  if (parse.data.resumeDocumentId) {
    const { data: doc } = await supabase
      .from('resume_documents')
      .select('id, user_id, filename, parsed_text')
      .eq('id', parse.data.resumeDocumentId)
      .maybeSingle<{ id: string; user_id: string; filename: string | null; parsed_text: string | null }>();
    if (!doc || doc.user_id !== userId) return jsonError(404, 'resume_not_found');
    if (!doc.parsed_text?.trim()) return jsonError(422, 'resume_not_parsed');
    resume = doc;
  }

  const nowIso = new Date().toISOString();
  // Long-term memory comes along to every session; the goal's own memories first.
  const [memories, playbook] = await Promise.all([
    goal ? Promise.resolve(goal.memories) : loadMemories(supabase, userId, null),
    parse.data.playbookId ? loadPlaybook(supabase, userId, parse.data.playbookId) : Promise.resolve(goal?.playbook ?? null),
  ]);
  const contextPack = buildContextPack({
    resumeText: resume?.parsed_text,
    resumeFilename: resume?.filename,
    jobDescription: parse.data.jobDescription ?? goal?.jobDescription,
    company: parse.data.company ?? goal?.company,
    role: parse.data.role ?? goal?.role,
    round: goal?.round,
    playbook,
    materials: goal?.materials ?? [],
    memories,
    now: new Date(nowIso),
  });
  // Only the server writes the context pack, the models and the speech settings.
  const clientMetadata = Object.fromEntries(
    Object.entries(parse.data.metadata ?? {}).filter(([key]) => !SERVER_METADATA_KEYS.has(key)),
  );
  // Settings → Answer model, frozen for the whole session; the setup step can pick another answer model.
  const models = await userModels(supabase, userId);
  if (parse.data.answerModel) {
    if (!isAllowedModel(parse.data.answerModel)) return jsonError(422, 'model_unavailable');
    models.answer = parse.data.answerModel;
  }
  const metadata = {
    ...clientMetadata,
    ...(contextPack ? { context_pack: contextPack } : {}),
    models,
    stt: { language: parse.data.language ?? null, singleMic: parse.data.singleMic === true },
    ...(parse.data.codingLanguage ? { codingLanguage: parse.data.codingLanguage } : {}),
    ...(goal ? { goal_id: goal.goalId } : {}),
  };

  // Users can't create sessions themselves (migration 0028): only this route,
  // after the quota check.
  const { data, error } = await createAdminClient()
    .from('copilot_sessions')
    .insert({
      user_id: userId,
      interview_session_id: parse.data.interviewSessionId ?? null,
      title: parse.data.title ?? null,
      metadata: grantConsentMetadata(withHeartbeatMetadata(metadata, nowIso), nowIso),
      status: 'active',
      started_at: nowIso,
    })
    .select(SESSION_COLUMNS)
    .single();

  if (error) return jsonError(500, 'db_error', error);

  return NextResponse.json({
    session: data,
    quota: {
      monthly_remaining: quota.monthly.remaining,
      daily_remaining: quota.daily.remaining,
      per_session_remaining: quota.perSession.remaining,
    },
  }, { status: 201 });
}
