import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { checkQuota, recordUsage } from '@/lib/quota';

const CreateSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1),
  tokens: z.number().int().optional(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_msgs:get:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('interview_session_messages')
    .select('*')
    .eq('session_id', id)
    .order('created_at', { ascending: true });

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ messages: data });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_msgs:post:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const parse = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Check session quota (30 min/session)
  const sessionQuota = await checkQuota(userData.user.id, 'copilot_session_minutes');
  if (!sessionQuota.allowed) {
    return jsonError(403, 'quota_exceeded', {
      type: 'copilot_session_minutes',
      used: sessionQuota.used,
      limit: sessionQuota.limit,
      message: 'Session time limit (30 min) exceeded',
    });
  }

  // Check daily quota (45 min/day)
  const dailyQuota = await checkQuota(userData.user.id, 'copilot_daily_minutes');
  if (!dailyQuota.allowed) {
    return jsonError(403, 'quota_exceeded', {
      type: 'copilot_daily_minutes',
      used: dailyQuota.used,
      limit: dailyQuota.limit,
      message: 'Daily time limit (45 min) exceeded',
    });
  }

  const { data, error } = await supabase
    .from('interview_session_messages')
    .insert({
      session_id: id,
      user_id: userData.user.id,
      role: parse.data.role,
      content: parse.data.content,
      tokens: parse.data.tokens ?? null,
    })
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);

  // Record usage: estimate ~1 minute per message (rough approximation)
  await recordUsage(userData.user.id, 'copilot_session_minutes', 1, id);
  await recordUsage(userData.user.id, 'copilot_daily_minutes', 1, id);

  return NextResponse.json({ message: data }, { status: 201 });
}
