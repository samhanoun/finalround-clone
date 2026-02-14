import { createClient } from '@supabase/supabase-js';
import { env, requireEnv } from '@/lib/env';

export function createAdminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server admin operations');
  }

  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
