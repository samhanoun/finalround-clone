import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jobFunnel, type JobRow } from '@/lib/analytics/jobSearch';

/**
 * GET /api/analytics/funnel
 * The signed-in user's job-search funnel, from their Jobs board (active jobs).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('job_applications')
    .select('stage, applied_at')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(5000);
  if (error) {
    console.error('Error fetching the job funnel:', error.message);
    return NextResponse.json({ error: 'Failed to fetch funnel data' }, { status: 500 });
  }
  return NextResponse.json(jobFunnel((data ?? []) as JobRow[]), { headers: { 'Cache-Control': 'private, no-store' } });
}
