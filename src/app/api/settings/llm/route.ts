import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { getLLMClient, MODEL_CONFIGS } from '@/lib/llmRouter';

const PatchSchema = z.object({
  provider: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  auto_optimize: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `llm_settings:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('llm_settings')
    .select('*')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (error) return jsonError(500, 'db_error', error);

  // Get available models for the user
  const client = getLLMClient();
  const availableProviders = ['openai', 'anthropic', 'google'].filter((p) =>
    client.isProviderAvailable(p)
  );

  const availableModels = Object.values(MODEL_CONFIGS)
    .filter((m) => availableProviders.includes(m.provider))
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
    }));

  return NextResponse.json({
    settings: data,
    availableProviders,
    availableModels,
  });
}

export async function PATCH(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `llm_settings:patch:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const patch = parse.data;

  // Validate model if provided
  if (patch.model && !MODEL_CONFIGS[patch.model]) {
    return jsonError(400, 'invalid_model', {
      message: `Unknown model: ${patch.model}`,
      availableModels: Object.keys(MODEL_CONFIGS),
    });
  }

  // Validate provider if provided
  if (patch.provider) {
    const client = getLLMClient();
    if (!client.isProviderAvailable(patch.provider)) {
      return jsonError(400, 'provider_unavailable', {
        message: `Provider ${patch.provider} is not configured`,
        availableProviders: ['openai', 'anthropic', 'google'].filter((p) =>
          client.isProviderAvailable(p)
        ),
      });
    }
  }

  // upsert so first-time users can set settings
  const { data, error } = await supabase
    .from('llm_settings')
    .upsert(
      {
        user_id: userData.user.id,
        provider: patch.provider,
        model: patch.model,
        temperature: patch.temperature,
        max_tokens: patch.max_tokens,
        auto_optimize: patch.auto_optimize ?? true,
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ settings: data });
}
