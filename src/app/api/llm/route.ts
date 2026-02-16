import { NextResponse, type NextRequest } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { llmProvider, requireEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { checkQuota, recordUsage } from '@/lib/quota';

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1),
  model: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `llm:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return jsonError(401, 'unauthorized');
  const user = userData.user;

  // Check quota - smart mode or regular copilot minutes
  const isSmartMode = parse.data.metadata?.smart_mode === true;
  const counterType = isSmartMode ? 'smart_mode_minutes' : 'copilot_minutes';
  const quota = await checkQuota(user.id, counterType);
  if (!quota.allowed) {
    return jsonError(403, 'quota_exceeded', {
      type: counterType,
      used: quota.used,
      limit: quota.limit,
      message: `Monthly ${counterType} quota exceeded`,
    });
  }

  const provider = llmProvider();
  if (provider !== 'openai') return jsonError(400, `unsupported_provider:${provider}`);

  const admin = createAdminClient();
  const model = parse.data.model ?? 'gpt-4o-mini';

  const { data: job } = await admin
    .from('jobs')
    .insert({
      user_id: user.id,
      kind: 'llm',
      status: 'running',
      provider,
      model,
      input: { messages: parse.data.messages, metadata: parse.data.metadata ?? {} },
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  try {
    const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });

    const completion = await client.chat.completions.create({
      model,
      messages: parse.data.messages,
    });

    const text = completion.choices[0]?.message?.content ?? '';

    // Estimate minutes used (rough: 1 min per 100k tokens, assume ~4 tokens/word, avg 500 words/request)
    const estimatedMinutes = 1;
    await recordUsage(user.id, counterType, estimatedMinutes);

    if (job?.id) {
      await admin
        .from('jobs')
        .update({
          status: 'succeeded',
          output: completion as unknown as Record<string, unknown>,
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }

    return NextResponse.json({ text, raw: completion, jobId: job?.id ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error';

    if (job?.id) {
      await admin
        .from('jobs')
        .update({
          status: 'failed',
          error: msg,
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }

    return jsonError(500, 'llm_failed', { message: msg });
  }
}
