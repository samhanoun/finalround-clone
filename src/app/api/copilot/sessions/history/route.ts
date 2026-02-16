import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { jsonError } from '@/lib/api';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:history:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const { data: sessions, error } = await supabase
    .from('copilot_sessions')
    .select('id, title, metadata, status, started_at, stopped_at, consumed_minutes, created_at')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return jsonError(500, 'db_error', error);

  return NextResponse.json({ sessions: sessions ?? [] });
}
