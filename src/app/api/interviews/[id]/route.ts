import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

/**
 * One practice interview: GET it, rename it (PATCH { title }), or DELETE it
 * with its questions, answers and reports. Every query is limited to the
 * signed-in user's own rows, on top of RLS, so another user's id is a 404.
 */

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_sessions:id:get:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (error || !data) return jsonError(404, 'not_found');
  return NextResponse.json({ session: data });
}

/** Rename. Only the title: the setup and status belong to the practice routes. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_sessions:id:patch:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const parse = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('interview_sessions')
    .update({ title: parse.data.title })
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .select('id, title, status, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('[interviews] rename failed', { code: error.code ?? null });
    return jsonError(500, 'db_error');
  }
  if (!data) return jsonError(404, 'not_found');
  return NextResponse.json({ session: data });
}

/** Delete, with its questions and reports (the foreign keys cascade too). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_sessions:id:del:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  const { data: deleted, error } = await supabase
    .from('interview_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) {
    console.error('[interviews] delete failed', { code: error.code ?? null });
    return jsonError(500, 'db_error');
  }
  if (!deleted?.length) return jsonError(404, 'not_found');

  // The foreign keys cascade these away; deleting them here as well covers a
  // database without the cascade, and only ever touches this user's rows.
  const [{ error: questionsError }, { error: reportsError }] = await Promise.all([
    supabase.from('interview_questions').delete().eq('session_id', id).eq('user_id', userId),
    supabase.from('interview_reports').delete().eq('session_id', id).eq('user_id', userId),
  ]);
  if (questionsError || reportsError) {
    console.error('[interviews] cleanup after delete failed', {
      questions: questionsError?.code ?? null,
      reports: reportsError?.code ?? null,
    });
  }

  return NextResponse.json({ ok: true });
}
