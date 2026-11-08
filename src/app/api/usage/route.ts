import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

/** Each usage meter and the quota counter it reads. */
const METERS = {
  copilot_minutes_monthly: 'copilot_minutes',
  copilot_session_minutes: 'copilot_session_minutes',
  copilot_daily_minutes: 'copilot_daily_minutes',
  resume_deep_reviews_monthly: 'resume_deep_reviews',
} as const;

type Meter = keyof typeof METERS;

type QuotaRow = { used: number | null; limit_val: number | null };

/**
 * GET /api/usage: the signed-in user's plan, and this period's usage against its limits. The limits
 * are the plan's own, as check_quota reads them from `plans` (Free's when there's no active plan), so
 * Pro, Tester or any later plan shows its real figures. `isPro` means any paid plan: those get
 * "Manage billing" instead of an offer to upgrade.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const meters = Object.keys(METERS) as Meter[];
  const [planResult, ...quotaResults] = await Promise.all([
    admin.rpc('get_user_plan', { p_user_id: user.id }),
    ...meters.map((meter) => admin.rpc('check_quota', { p_user_id: user.id, p_counter_type: METERS[meter] })),
  ]);

  // A figure that couldn't be read isn't shown as zero.
  const failed = [planResult, ...quotaResults].find((result) => result.error);
  if (failed?.error) {
    console.error('[usage] could not read the plan or a quota', failed.error.message);
    return NextResponse.json({ error: 'usage_unavailable' }, { status: 500 });
  }

  // No row: no active plan, so the free one.
  const plan = (planResult.data as Array<{ plan_id: string; plan_name: string | null }> | null)?.[0] ?? null;
  const limits = {} as Record<Meter, number>;
  const usage = {} as Record<Meter, number>;
  meters.forEach((meter, i) => {
    const row = (quotaResults[i].data as QuotaRow[] | null)?.[0];
    limits[meter] = row?.limit_val ?? 0;
    usage[meter] = row?.used ?? 0;
  });

  return NextResponse.json({
    plan: plan?.plan_name ?? 'Free',
    isPro: !!plan && plan.plan_id !== 'free',
    limits,
    usage,
  });
}
