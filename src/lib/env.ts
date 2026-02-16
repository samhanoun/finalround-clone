import { z } from 'zod';

// IMPORTANT:
// Do not throw at module-eval time (e.g. during `next build`) when env vars
// are not present. We validate on-demand via `requireEnv()`.

const RawEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),

  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  LLM_PROVIDER: z.enum(['openai']).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

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
});

export const env = RawEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  PRICE_ID_PRO_EUR: process.env.PRICE_ID_PRO_EUR,
  PRICE_ID_PRO_USD: process.env.PRICE_ID_PRO_USD,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,

  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export function requireEnv(name: keyof typeof env): string {
  const val = env[name];
  if (!val) throw new Error(`Missing env var: ${String(name)}`);
  return val;
}

export function llmProvider() {
  return env.LLM_PROVIDER ?? 'openai';
}
