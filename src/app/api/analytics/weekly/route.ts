import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { weeklyActivity, weekStart, WEEKS_SHOWN, type ActivityRows } from '@/lib/analytics/jobSearch';

/**
 * GET /api/analytics/weekly
 * The signed-in user's activity per week for the last 8 weeks: practice
 * interviews and their scores, live sessions and minutes, applications sent.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const since = weekStart(new Date());
  since.setUTCDate(since.getUTCDate() - (WEEKS_SHOWN - 1) * 7);
  const from = since.toISOString();

  const [practice, reports, live, applications] = await Promise.all([
    supabase.from('interview_sessions').select('created_at').eq('user_id', user.id).gte('created_at', from).limit(5000),
    supabase.from('interview_reports').select('generated_at, overall_score').eq('user_id', user.id).gte('generated_at', from).limit(5000),
    supabase.from('copilot_sessions').select('started_at, consumed_minutes').eq('user_id', user.id).gte('started_at', from).limit(5000),
    supabase.from('job_applications').select('applied_at').eq('user_id', user.id).gte('applied_at', from).limit(5000),
  ]);
  const failed = [practice, reports, live, applications].find((result) => result.error);
  if (failed) {
    console.error('Error fetching weekly activity:', failed.error?.message);
    return NextResponse.json({ error: 'Failed to fetch weekly activity' }, { status: 500 });
  }

  const rows: ActivityRows = {
    practice: (practice.data ?? []) as ActivityRows['practice'],
    reports: (reports.data ?? []) as ActivityRows['reports'],
    live: (live.data ?? []) as ActivityRows['live'],
    applications: (applications.data ?? []) as ActivityRows['applications'],
  };
  return NextResponse.json({ weeks: weeklyActivity(rows) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
