import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  OVERVIEW_LOOKBACK_DAYS,
  OVERVIEW_ROW_LIMIT,
  type OverviewResponse,
} from '@/lib/analytics/overview';

/**
 * GET /api/analytics/overview
 * The signed-in user's own live sessions, practice interviews and scored
 * reports from the lookback window. Reads with the user's client, so RLS
 * scopes every row to them; the browser aggregates (lib/analytics/overview).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const since = new Date(Date.now() - OVERVIEW_LOOKBACK_DAYS * 86_400_000).toISOString();

  const [live, practice, reports] = await Promise.all([
    supabase
      .from('copilot_sessions')
      .select('started_at, consumed_minutes')
      .eq('user_id', user.id)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(OVERVIEW_ROW_LIMIT),
    supabase
      .from('interview_sessions')
      .select('created_at')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(OVERVIEW_ROW_LIMIT),
    supabase
      .from('interview_reports')
      .select('generated_at, overall_score')
      .eq('user_id', user.id)
      .gte('generated_at', since)
      .order('generated_at', { ascending: false })
      .limit(OVERVIEW_ROW_LIMIT),
  ]);

  const failed = [live, practice, reports].find((result) => result.error);
  if (failed) {
    console.error('Error fetching analytics overview:', failed.error);
    return NextResponse.json({ error: 'Failed to fetch analytics overview' }, { status: 500 });
  }

  const body: OverviewResponse = {
    since,
    truncated: [live, practice, reports].some((result) => (result.data?.length ?? 0) >= OVERVIEW_ROW_LIMIT),
    liveSessions: live.data ?? [],
    practiceInterviews: practice.data ?? [],
    reports: reports.data ?? [],
  };

  return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
}
