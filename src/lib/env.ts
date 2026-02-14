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
});

export const env = RawEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
});

export function requireEnv(name: keyof typeof env): string {
  const val = env[name];
  if (!val) throw new Error(`Missing env var: ${String(name)}`);
  return val;
}

export function llmProvider() {
  return env.LLM_PROVIDER ?? 'openai';
}
