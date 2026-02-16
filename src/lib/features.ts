import { env } from '@/lib/env';

export function isLiveCopilotBetaEnabled() {
  const raw = env.NEXT_PUBLIC_BETA_LIVE_COPILOT;
  if (!raw) return false;

  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
