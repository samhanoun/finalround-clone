import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

/**
 * GET /api/interviews/:id/export - one interview as a JSON file (the practice
 * report's Export): the session, its questions with your answers and the
 * feedback on each, the report, and the chat messages older interviews kept.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_export:get:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // RLS keeps this to the user's own interviews.
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle<{ id: string; created_at?: string | null } & Record<string, unknown>>();
  if (!session) return jsonError(404, 'not_found');

  const [{ data: questions }, { data: reports }, { data: messages }] = await Promise.all([
    supabase
      .from('interview_questions')
      .select('question_text, question_type, difficulty, order_index, response_text, response_score, rubric, answered_at, created_at')
      .eq('session_id', id)
      .order('order_index', { ascending: true })
      // A follow-up shares its question's order_index and comes after it.
      .order('created_at', { ascending: true }),
    supabase
      .from('interview_reports')
      .select('overall_score, hiring_signal, summary, strengths, weaknesses, next_steps, rubric, generated_at')
      .eq('session_id', id)
      .order('generated_at', { ascending: false })
      .limit(1),
    supabase.from('interview_session_messages').select('*').eq('session_id', id).order('created_at', { ascending: true }),
  ]);

  const day = typeof session.created_at === 'string' ? session.created_at.slice(0, 10) : '';
  const filename = `practice-interview-${day || session.id}.json`;
  return NextResponse.json(
    { session, questions: questions ?? [], report: reports?.[0] ?? null, messages: messages ?? [] },
    { headers: { 'content-disposition': `attachment; filename="${filename}"` } },
  );
}
