import { checkQuota, recordUsage } from '@/lib/quota';

export interface CopilotQuotaSnapshot {
  monthly: Awaited<ReturnType<typeof checkQuota>>;
  daily: Awaited<ReturnType<typeof checkQuota>>;
  perSession: Awaited<ReturnType<typeof checkQuota>>;
}

export async function getCopilotQuotaSnapshot(userId: string): Promise<CopilotQuotaSnapshot> {
  const [monthly, daily, perSession] = await Promise.all([
    checkQuota(userId, 'copilot_minutes'),
    checkQuota(userId, 'copilot_daily_minutes'),
    checkQuota(userId, 'copilot_session_minutes'),
  ]);

  return { monthly, daily, perSession };
}

export function getElapsedUsage(startedAtIso: string, now = new Date()) {
  const startedAt = new Date(startedAtIso);
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const elapsedMinutes = Math.max(1, Math.ceil(elapsedSeconds / 60));

  return {
    elapsedSeconds,
    elapsedMinutes,
  };
}

export function getBillableMinutes(
  elapsedMinutes: number,
  quota: CopilotQuotaSnapshot,
) {
  const monthCap = Math.max(0, quota.monthly.remaining);
  const dayCap = Math.max(0, quota.daily.remaining);
  const sessionCap = Math.max(0, quota.perSession.remaining);

  return Math.max(0, Math.min(elapsedMinutes, monthCap, dayCap, sessionCap));
}

export async function recordCopilotUsage(userId: string, minutes: number) {
  if (minutes <= 0) return;

  await Promise.all([
    recordUsage(userId, 'copilot_minutes', minutes),
    recordUsage(userId, 'copilot_daily_minutes', minutes),
    recordUsage(userId, 'copilot_session_minutes', minutes),
  ]);
}
