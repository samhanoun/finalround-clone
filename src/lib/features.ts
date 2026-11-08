import { env } from '@/lib/env';

/**
 * The live copilot is on by default. NEXT_PUBLIC_BETA_LIVE_COPILOT only turns
 * it off, when set to "false" or "0"; anything else (or nothing) leaves it on.
 */
export function isLiveCopilotEnabled(): boolean {
  const raw = env.NEXT_PUBLIC_BETA_LIVE_COPILOT?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}
