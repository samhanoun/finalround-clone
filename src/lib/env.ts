import { z } from 'zod';

const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  LLM_PROVIDER: z.enum(['openai']).default('openai'),
  OPENAI_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,

  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  LLM_PROVIDER: process.env.LLM_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
});
