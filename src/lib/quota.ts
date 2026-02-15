import { createAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/api';
import { NextRequest } from 'next/server';

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

// Check if user has quota for a counter type
export async function checkQuota(userId: string, counterType: CounterType): Promise<QuotaCheck> {
  const { data, error } = await admin().rpc('check_quota', {
    p_user_id: userId,
    p_counter_type: counterType,
  });
  
  if (error || !data || data.length === 0) {
    // Default: no quota
    return { allowed: false, used: 0, limit: 0, remaining: 0 };
  }
  
  return {
    allowed: data[0].allowed,
    used: data[0].used,
    limit: data[0].limit_val,
    remaining: data[0].remaining,
  };
}

// Record usage after operation completes
export async function recordUsage(
  userId: string, 
  counterType: CounterType, 
  amount: number,
  sessionId?: string,
  sessionStart?: Date
) {
  const { error } = await admin().rpc('record_usage', {
    p_user_id: userId,
    p_counter_type: counterType,
    p_amount: amount,
    p_session_id: sessionId ?? null,
    p_session_start: sessionStart ?? null,
  });
  
  if (error) {
    console.error('Failed to record usage:', error);
  }
}

// Quota enforcement middleware for API routes
export async function enforceQuota(
  userId: string,
  counterType: CounterType,
  req: NextRequest
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
