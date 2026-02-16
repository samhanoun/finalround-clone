import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const anonRl = await rateLimit({ key: `copilot:get:anon:${ip}`, limit: 120, windowMs: 60_000 });
  if (!anonRl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const userRl = await rateLimit({ key: `copilot:get:user:${userId}`, limit: 240, windowMs: 60_000 });
  if (!userRl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, interview_session_id, title, metadata, status, started_at, stopped_at, duration_seconds, consumed_minutes, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (sessionError || !session) return jsonError(404, 'session_not_found');

  const [{ data: events, error: eventsError }, { data: summaries, error: summariesError }] = await Promise.all([
    supabase
      .from('copilot_events')
      .select('id, event_type, payload, created_at')
      .eq('session_id', id)
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(200),
    supabase
      .from('copilot_summaries')
      .select('id, summary_type, content, payload, created_at, updated_at')
      .eq('session_id', id)
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ]);

  if (eventsError) return jsonError(500, 'db_error', eventsError);
  if (summariesError) return jsonError(500, 'db_error', summariesError);

  return NextResponse.json({
    session,
    events: events ?? [],
    summaries: summaries ?? [],
  });
}
