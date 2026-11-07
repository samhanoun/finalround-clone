import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rateLimit';
import { MAX_SCHEDULES, nextSendAt, userTimeZone } from '@/lib/analyticsReports';
import { REPORT_FREQUENCIES, REPORT_TYPES } from '@/lib/analyticsReportTypes';

/**
 * Analytics → Reports: the user's scheduled email reports
 * (src/lib/analyticsReports.ts). Users read their rows; writes go through here.
 */

const COLUMNS = 'id, report_type, frequency, enabled, last_sent_at, next_send_at, created_at';

const CreateSchema = z.object({ report_type: z.enum(REPORT_TYPES), frequency: z.enum(REPORT_FREQUENCIES) });
const UpdateSchema = z.object({ id: z.string().uuid(), enabled: z.boolean() });

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// GET /api/analytics/reports
export async function GET() {
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabase
    .from('analytics_report_schedules')
    .select(COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  return NextResponse.json({ reports: data ?? [], email: user.email ?? null, emailConfigured: Boolean(process.env.SENDGRID_API_KEY) });
}

// POST /api/analytics/reports {report_type, frequency}
export async function POST(request: NextRequest) {
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parse = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { count } = await supabase
    .from('analytics_report_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  if ((count ?? 0) >= MAX_SCHEDULES) return NextResponse.json({ error: 'too_many' }, { status: 409 });

  const next = nextSendAt(parse.data.frequency, new Date(), await userTimeZone(user.id));
  const { data, error } = await createAdminClient()
    .from('analytics_report_schedules')
    .insert({ user_id: user.id, ...parse.data, next_send_at: next.toISOString() })
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to create report' }, { status: 500 });
  return NextResponse.json({ report: data }, { status: 201 });
}

// PUT /api/analytics/reports {id, enabled}
export async function PUT(request: NextRequest) {
  const { user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parse = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('analytics_report_schedules')
    .select('frequency')
    .eq('id', parse.data.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Turning a report back on schedules it from now, so it doesn't fire for the time it was off.
  const updates = parse.data.enabled
    ? { enabled: true, next_send_at: nextSendAt(existing.frequency, new Date(), await userTimeZone(user.id)).toISOString() }
    : { enabled: false };
  const { data, error } = await admin
    .from('analytics_report_schedules')
    .update(updates)
    .eq('id', parse.data.id)
    .eq('user_id', user.id)
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: 'Failed to update report' }, { status: 500 });
  return NextResponse.json({ report: data });
}

// DELETE /api/analytics/reports?id=…
export async function DELETE(request: NextRequest) {
  const { user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const rl = await rateLimit({ key: `report_delete:${user.id}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const { error } = await createAdminClient().from('analytics_report_schedules').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'Failed to delete report' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
