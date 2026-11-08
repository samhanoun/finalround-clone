import { z } from 'zod';

// IMPORTANT:
// Do not throw at module-eval time (e.g. during `next build`) when env vars
// are not present. We validate on-demand via `requireEnv()`.

const RawEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_BETA_LIVE_COPILOT: z.string().optional(),

  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // LLM providers. Models are routed by id ("claude-*" → Anthropic, "gpt-*"/"o*"
  // → OpenAI). LLM_PROVIDER only says which provider the question gate tries
  // first when both have keys ('google' is accepted but not used).
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'google', 'auto']).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Live copilot models (OpenAI or Anthropic model ids)
  COPILOT_GATE_MODEL: z.string().min(1).optional(),
  COPILOT_ANSWER_MODEL: z.string().min(1).optional(),
  COPILOT_CODING_MODEL: z.string().min(1).optional(),

  // Speech-to-text (server-only; used by the STT relay in server.ts)
  DEEPGRAM_API_KEY: z.string().min(1).optional(),
  DEEPGRAM_MODEL: z.string().regex(/^[a-z0-9._-]+$/i).optional(),
  DEEPGRAM_LANGUAGE: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$|^multi$/i).optional(),

  // Billing (server-only)
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PRICE_ID_PRO_EUR: z.string().min(1).optional(),
  PRICE_ID_PRO_USD: z.string().min(1).optional(),

  // App base URL (used for Stripe redirects)
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // Rate limiting (Upstash Redis)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),

  // Cron job authentication
  CRON_SECRET: z.string().min(32).optional(),
});

// `KEY=` lines in .env files arrive as '', which would fail the min(1)/url()
// checks at import time; treat them as unset instead.
function blankToUndefined<T extends Record<string, string | undefined>>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value?.trim() === '' ? undefined : value]),
  ) as T;
}

export const env = RawEnvSchema.parse(blankToUndefined({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_BETA_LIVE_COPILOT: process.env.NEXT_PUBLIC_BETA_LIVE_COPILOT,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

  COPILOT_GATE_MODEL: process.env.COPILOT_GATE_MODEL,
  COPILOT_ANSWER_MODEL: process.env.COPILOT_ANSWER_MODEL,
  COPILOT_CODING_MODEL: process.env.COPILOT_CODING_MODEL,

  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
  DEEPGRAM_MODEL: process.env.DEEPGRAM_MODEL,
  DEEPGRAM_LANGUAGE: process.env.DEEPGRAM_LANGUAGE,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  PRICE_ID_PRO_EUR: process.env.PRICE_ID_PRO_EUR,
  PRICE_ID_PRO_USD: process.env.PRICE_ID_PRO_USD,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,

  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,

  CRON_SECRET: process.env.CRON_SECRET,
}));

export function requireEnv(name: keyof typeof env): string {
  const val = env[name];
  if (!val) throw new Error(`Missing env var: ${String(name)}`);
  return val;
}

/** The question gate's preferred provider (see src/lib/copilot/gateModel.ts). */
export function llmProvider() {
  return env.LLM_PROVIDER ?? 'auto';
}
