import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { normalizeMockInterviewReport } from '@/lib/mockInterviewReport';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const anonRl = await rateLimit({ key: `copilot:report:anon:${ip}`, limit: 120, windowMs: 60_000 });
  if (!anonRl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const userRl = await rateLimit({ key: `copilot:report:user:${userId}`, limit: 240, windowMs: 60_000 });
  if (!userRl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, metadata')
    .eq('id', id)
    .eq('user_id', userId)
    .single<{ id: string; user_id: string; metadata: Record<string, unknown> | null }>();

  if (sessionError || !session) return jsonError(404, 'session_not_found');

  const { data: summaries, error: summaryError } = await supabase
    .from('copilot_summaries')
    .select('id, summary_type, content, payload, created_at, updated_at')
    .eq('session_id', id)
    .eq('user_id', userId)
    .in('summary_type', ['mock_interview_report', 'final'])
    .order('updated_at', { ascending: false })
    .limit(5);

  if (summaryError) return jsonError(500, 'db_error', summaryError);

  const mode = typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';
  const reportSource = (summaries ?? []).find((row) => {
    const payload = row.payload as Record<string, unknown> | null;
    return !!payload && (payload.report || payload.rubric || payload.overall_score);
  });

  if (!reportSource) {
    return jsonError(404, 'report_not_found');
  }

  const rawPayload = (reportSource.payload as Record<string, unknown> | null) ?? {};
  const report = normalizeMockInterviewReport((rawPayload.report as unknown) ?? rawPayload, mode);

  return NextResponse.json({
    report,
    summary: reportSource,
  });
}
