import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { providerForModel } from '@/lib/llmRouter';
import { isAllowedModel, loadModelSettings, modelChoices } from '@/lib/answerModels';
import { ANSWER_LENGTH_IDS, ANSWER_STYLES, ANSWER_STYLE_IDS, type AnswerLength, type AnswerStyle } from '@/lib/answerStyle';

/** Settings → Answer model. Only models this server can call are accepted. */

const PatchSchema = z.object({
  answerModel: z.string().min(1).max(100).nullable(),
  codingModel: z.string().min(1).max(100).nullable(),
  style: z.enum(ANSWER_STYLE_IDS as [AnswerStyle, ...AnswerStyle[]]),
  length: z.enum(ANSWER_LENGTH_IDS as [AnswerLength, ...AnswerLength[]]),
});

function ipOf(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function GET(req: NextRequest) {
  const rl = await rateLimit({ key: `llm_settings:get:${ipOf(req)}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  return NextResponse.json({ settings: await loadModelSettings(supabase, userData.user.id), ...modelChoices() });
}

export async function PATCH(req: NextRequest) {
  const rl = await rateLimit({ key: `llm_settings:patch:${ipOf(req)}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const parse = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());
  const { answerModel, codingModel, style, length } = parse.data;

  for (const model of [answerModel, codingModel]) {
    if (model && !isAllowedModel(model)) return jsonError(422, 'model_unavailable', { model });
  }

  const { error } = await supabase.from('llm_settings').upsert(
    {
      user_id: userData.user.id,
      provider: answerModel ? providerForModel(answerModel) : null,
      model: answerModel,
      coding_model: codingModel,
      temperature: ANSWER_STYLES[style].temperature,
      answer_length: length,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return jsonError(500, 'db_error', error);

  return NextResponse.json({ settings: await loadModelSettings(supabase, userData.user.id) });
}
