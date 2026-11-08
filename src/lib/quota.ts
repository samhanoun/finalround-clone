import { createAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/api';

function admin() {
  // IMPORTANT: don't initialize at module-eval time (Next build imports API routes).
  return createAdminClient();
}

// Counter types
export type CounterType = 
  | 'copilot_minutes' 
  | 'copilot_session_minutes' 
  | 'copilot_daily_minutes' 
  | 'smart_mode_minutes' 
  | 'resume_deep_reviews';

interface QuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}

// Get user's current plan limits (server-side only)
export async function getUserPlan(userId: string) {
  const { data, error } = await admin().rpc('get_user_plan', { p_user_id: userId });
  if (error || !data || data.length === 0) {
    // Default to free plan
    return {
      plan_id: 'free',
      plan_name: 'Free',
      copilot_minutes_monthly: 0,
      copilot_session_minutes: 0,
      copilot_daily_minutes: 0,
      smart_mode_minutes_monthly: 0,
      resume_deep_reviews_monthly: 0,
    };
  }
  return data[0];
}

/** The current quota, or null when it couldn't be read. */
async function readQuota(userId: string, counterType: CounterType): Promise<QuotaCheck | null> {
  const { data, error } = await admin().rpc('check_quota', {
    p_user_id: userId,
    p_counter_type: counterType,
  });
  if (error || !data || data.length === 0) return null;
  return {
    allowed: data[0].allowed,
    used: data[0].used,
    limit: data[0].limit_val,
    remaining: data[0].remaining,
  };
}

// Check if user has quota for a counter type
export async function checkQuota(userId: string, counterType: CounterType): Promise<QuotaCheck> {
  // Default when it can't be read: no quota
  return (await readQuota(userId, counterType)) ?? { allowed: false, used: 0, limit: 0, remaining: 0 };
}

// Record usage after operation completes. False when it couldn't be recorded.
export async function recordUsage(
  userId: string, 
  counterType: CounterType, 
  amount: number,
  sessionId?: string,
  sessionStart?: Date
): Promise<boolean> {
  const { error } = await admin().rpc('record_usage', {
    p_user_id: userId,
    p_counter_type: counterType,
    p_amount: amount,
    p_session_id: sessionId ?? null,
    p_session_start: sessionStart ?? null,
  });
  
  if (error) {
    console.error('Failed to record usage:', error);
    return false;
  }
  return true;
}

export type Reservation =
  | { ok: true; reservedAt: Date }
  | { ok: false; error: 'quota_exceeded' | 'quota_unavailable'; used: number; limit: number };

/**
 * Takes one unit of a monthly quota before slow work starts, so parallel
 * requests can't all pass the same check. The counter goes up first (one
 * atomic update), then is compared with the limit; a reservation that went
 * over is handed back. Anything unreadable refuses the work.
 */
export async function reserveQuota(userId: string, counterType: CounterType): Promise<Reservation> {
  const before = await readQuota(userId, counterType);
  if (!before) return { ok: false, error: 'quota_unavailable', used: 0, limit: 0 };
  if (!before.allowed) return { ok: false, error: 'quota_exceeded', used: before.used, limit: before.limit };

  const reservedAt = new Date();
  if (!(await recordUsage(userId, counterType, 1))) return { ok: false, error: 'quota_unavailable', used: before.used, limit: before.limit };
  const after = await readQuota(userId, counterType);
  if (after && after.used <= after.limit) return { ok: true, reservedAt };

  await releaseQuota(userId, counterType, reservedAt);
  return after
    ? { ok: false, error: 'quota_exceeded', used: after.used - 1, limit: after.limit }
    : { ok: false, error: 'quota_unavailable', used: before.used, limit: before.limit };
}

const monthOf = (date: Date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}`;

/** Hands back a reservation whose work failed (not across a month boundary: that month's count has closed). */
export async function releaseQuota(userId: string, counterType: CounterType, reservedAt: Date, now = new Date()) {
  if (monthOf(reservedAt) !== monthOf(now)) return;
  if (!(await recordUsage(userId, counterType, -1))) {
    console.error('[quota] could not hand back a reservation', { userId, counterType });
  }
}

// Quota enforcement middleware for API routes
export async function enforceQuota(
  userId: string,
  counterType: CounterType
) {
  const quota = await checkQuota(userId, counterType);
  
  if (!quota.allowed) {
    return jsonError(403, 'quota_exceeded', {
      type: counterType,
      used: quota.used,
      limit: quota.limit,
      message: `Monthly ${counterType} quota exceeded`,
    });
  }
  
  return null; // Allowed
}

// Quick check if user is on Pro plan
export async function isProPlan(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId);
  return plan.plan_id === 'pro';
}
