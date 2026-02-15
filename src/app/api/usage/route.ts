import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

// Pro plan limits
const PRO_LIMITS = {
  copilot_minutes_monthly: 400,
  copilot_session_minutes: 30,
  copilot_daily_minutes: 45,
  smart_mode_minutes_monthly: 80,
  resume_deep_reviews_monthly: 10,
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Get user's plan from admin RPC
  const { data: planData } = await admin.rpc('get_user_plan', { p_user_id: user.id });
  const plan = planData?.[0] ?? {
    plan_id: 'free',
    plan_name: 'Free',
  };

  // Get current usage for each counter type
  const counterTypes = [
    'copilot_minutes',
    'copilot_session_minutes',
    'copilot_daily_minutes',
    'smart_mode_minutes',
    'resume_deep_reviews',
  ];

  const usage: Record<string, { used: number; limit: number; remaining: number }> = {};

  for (const counterType of counterTypes) {
    const { data } = await admin.rpc('check_quota', {
      p_user_id: user.id,
      p_counter_type: counterType,
    });

    if (data?.[0]) {
      usage[counterType] = {
        used: data[0].used ?? 0,
        limit: data[0].limit_val ?? 0,
        remaining: data[0].remaining ?? 0,
      };
    } else {
      // Default to 0 for free users
      usage[counterType] = { used: 0, limit: 0, remaining: 0 };
    }
  }

  // Return with plan limits merged
  const isPro = plan.plan_id === 'pro';
  
  return NextResponse.json({
    plan: plan.plan_name ?? 'Free',
    isPro,
    limits: {
      copilot_minutes_monthly: isPro ? PRO_LIMITS.copilot_minutes_monthly : usage.copilot_minutes?.limit ?? 0,
      copilot_session_minutes: isPro ? PRO_LIMITS.copilot_session_minutes : usage.copilot_session_minutes?.limit ?? 0,
      copilot_daily_minutes: isPro ? PRO_LIMITS.copilot_daily_minutes : usage.copilot_daily_minutes?.limit ?? 0,
      smart_mode_minutes_monthly: isPro ? PRO_LIMITS.smart_mode_minutes_monthly : usage.smart_mode_minutes?.limit ?? 0,
      resume_deep_reviews_monthly: isPro ? PRO_LIMITS.resume_deep_reviews_monthly : usage.resume_deep_reviews?.limit ?? 0,
    },
    usage: {
      copilot_minutes_monthly: usage.copilot_minutes?.used ?? 0,
      copilot_session_minutes: usage.copilot_session_minutes?.used ?? 0,
      copilot_daily_minutes: usage.copilot_daily_minutes?.used ?? 0,
      smart_mode_minutes_monthly: usage.smart_mode_minutes?.used ?? 0,
      resume_deep_reviews_monthly: usage.resume_deep_reviews?.used ?? 0,
    },
  });
}
