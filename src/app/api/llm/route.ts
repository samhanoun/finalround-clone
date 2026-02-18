import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { llmProvider, requireEnv, defaultModel, fallbackModel } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { checkQuota, recordUsage } from '@/lib/quota';
import {
  selectModel,
  getFallbackChain,
  getUserPreferences,
  detectTaskType,
  getLLMClient,
  MODEL_CONFIGS,
} from '@/lib/llmRouter';

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
  provider: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  task_type: z
    .enum(['simple_qa', 'coding', 'analysis', 'writing', 'conversation', 'complex'])
    .optional(),
  prefer_speed: z.boolean().optional(),
  prefer_cost: z.boolean().optional(),
  prefer_quality: z.boolean().optional(),
  use_fallback: z.boolean().optional(),
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

  // Get user preferences
  const userPrefs = await getUserPreferences(user.id);
  const autoOptimize = userPrefs?.auto_optimize ?? true;

  // Determine model selection
  let selectedModel: string;
  let taskType = parse.data.task_type;
  
  // Auto-detect task type if not provided and auto-optimize is enabled
  if (!taskType && autoOptimize) {
    taskType = detectTaskType(parse.data.messages);
  }
  
  const routingOptions = {
    taskType,
    preferSpeed: parse.data.prefer_speed,
    preferCost: parse.data.prefer_cost,
    preferQuality: parse.data.prefer_quality,
    userPreference: parse.data.model ?? userPrefs?.preferred_model,
  };

  // Use explicit model if provided, otherwise auto-select
  if (parse.data.model && MODEL_CONFIGS[parse.data.model]) {
    selectedModel = parse.data.model;
  } else if (autoOptimize) {
    selectedModel = selectModel(routingOptions);
  } else {
    selectedModel = parse.data.model ?? defaultModel();
  }

  const config = MODEL_CONFIGS[selectedModel];
  if (!config) {
    return jsonError(400, 'invalid_model', { message: `Unknown model: ${selectedModel}` });
  }

  // Get fallback chain if enabled
  const fallbackChain = parse.data.use_fallback !== false
    ? getFallbackChain(taskType, selectedModel)
    : undefined;

  const admin = createAdminClient();

  const { data: job } = await admin
    .from('jobs')
    .insert({
      user_id: user.id,
      kind: 'llm',
      status: 'running',
      provider: config.provider,
      model: selectedModel,
      input: {
        messages: parse.data.messages,
        metadata: parse.data.metadata ?? {},
        task_type: taskType,
      },
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  try {
    const client = getLLMClient();

    // Check if provider is available
    if (!client.isProviderAvailable(config.provider)) {
      // Try fallbacks if primary provider not available
      if (fallbackChain && fallbackChain.length > 1) {
        console.log(`Provider ${config.provider} not available, trying fallbacks`);
        const result = await client.complete(
          parse.data.messages,
          {
            fallbackChain,
            temperature: parse.data.temperature ?? userPrefs?.temperature ?? 0.7,
            max_tokens: parse.data.max_tokens ?? userPrefs?.max_tokens ?? 4096,
          }
        );
        
        const estimatedMinutes = 1;
        await recordUsage(user.id, counterType, estimatedMinutes);

        if (job?.id) {
          await admin
            .from('jobs')
            .update({
              status: 'succeeded',
              provider: result.provider,
              model: result.model,
              output: { text: result.text, raw: result.raw },
              finished_at: new Date().toISOString(),
            })
            .eq('id', job.id);
        }

        return NextResponse.json({
          text: result.text,
          model: result.model,
          provider: result.provider,
          raw: result.raw,
          jobId: job?.id ?? null,
        });
      }
      
      return jsonError(503, 'provider_unavailable', {
        message: `Provider ${config.provider} is not configured`,
        available: ['openai', 'anthropic', 'google'].filter((p) => client.isProviderAvailable(p)),
      });
    }

    const completion = await client.complete(
      parse.data.messages,
      {
        model: selectedModel,
        temperature: parse.data.temperature ?? userPrefs?.temperature ?? 0.7,
        max_tokens: parse.data.max_tokens ?? userPrefs?.max_tokens ?? 4096,
        fallbackChain,
      }
    );

    const text = completion.text;

    // Estimate minutes used (rough: 1 min per 100k tokens, assume ~4 tokens/word, avg 500 words/request)
    const estimatedMinutes = 1;
    await recordUsage(user.id, counterType, estimatedMinutes);

    if (job?.id) {
      await admin
        .from('jobs')
        .update({
          status: 'succeeded',
          output: { text, model: completion.model, raw: completion.raw },
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }

    return NextResponse.json({
      text,
      model: completion.model,
      provider: completion.provider,
      raw: completion.raw,
      jobId: job?.id ?? null,
    });
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

// GET available models
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `llm:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const client = getLLMClient();
  const availableProviders = ['openai', 'anthropic', 'google'].filter((p) =>
    client.isProviderAvailable(p)
  );

  const models = Object.values(MODEL_CONFIGS)
    .filter((m) => availableProviders.includes(m.provider))
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      contextWindow: m.contextWindow,
      costPer1kInput: m.costPer1kInput,
      costPer1kOutput: m.costPer1kOutput,
      avgLatencyMs: m.avgLatencyMs,
      strengths: m.strengths,
      bestFor: m.bestFor,
    }));

  return NextResponse.json({
    models,
    availableProviders,
  });
}
