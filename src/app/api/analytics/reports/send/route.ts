import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sendReport, type ReportSchedule } from '@/lib/analyticsReports';

// POST /api/analytics/reports/send {id} - email one of the user's reports now
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = await rateLimit({ key: `report_send_now:${user.id}`, limit: 3, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  if (!process.env.SENDGRID_API_KEY) return NextResponse.json({ error: 'email_not_configured' }, { status: 503 });

  const parse = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { data: schedule } = await supabase
    .from('analytics_report_schedules')
    .select('user_id, report_type, frequency')
    .eq('id', parse.data.id)
    .eq('user_id', user.id)
    .maybeSingle<Pick<ReportSchedule, 'user_id' | 'report_type' | 'frequency'>>();
  if (!schedule) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!(await sendReport(schedule))) return NextResponse.json({ error: 'not_sent' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
