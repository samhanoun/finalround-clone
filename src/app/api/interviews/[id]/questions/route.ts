import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

const CreateQuestionSchema = z.object({
  question_text: z.string().min(1).max(2000),
  question_type: z.enum(['behavioral', 'technical', 'situational', 'general']).default('behavioral'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  order_index: z.number().int().optional(),
});

const UpdateQuestionSchema = z.object({
  response_text: z.string().optional(),
  response_score: z.number().int().min(1).max(5).optional(),
  rubric: z.record(z.string(), z.any()).optional(),
  answered: z.boolean().optional(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_questions:get:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Verify session belongs to user
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .single();

  if (!session) return jsonError(404, 'not_found');

  const { data, error } = await supabase
    .from('interview_questions')
    .select('*')
    .eq('session_id', id)
    .order('order_index', { ascending: true });

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ questions: data });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_questions:post:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const parse = CreateQuestionSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Verify session belongs to user
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .single();

  if (!session) return jsonError(404, 'not_found');

  // Get max order_index for this session
  const { data: maxOrder } = await supabase
    .from('interview_questions')
    .select('order_index')
    .eq('session_id', id)
    .order('order_index', { ascending: false })
    .limit(1)
    .single();

  const nextIndex = maxOrder ? maxOrder.order_index + 1 : 0;

  const { data, error } = await supabase
    .from('interview_questions')
    .insert({
      session_id: id,
      user_id: userData.user.id,
      question_text: parse.data.question_text,
      question_type: parse.data.question_type,
      difficulty: parse.data.difficulty,
      order_index: parse.data.order_index ?? nextIndex,
    })
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ question: data }, { status: 201 });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_questions:patch:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const parse = UpdateQuestionSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Verify question belongs to user's session
  const { data: existing } = await supabase
    .from('interview_questions')
    .select('id, session_id')
    .eq('id', id)
    .single();

  if (!existing) return jsonError(404, 'not_found');

  // Verify session belongs to user
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id')
    .eq('id', existing.session_id)
    .eq('user_id', userData.user.id)
    .single();

  if (!session) return jsonError(404, 'not_found');

  const updateData: Record<string, unknown> = {};
  if (parse.data.response_text !== undefined) updateData.response_text = parse.data.response_text;
  if (parse.data.response_score !== undefined) updateData.response_score = parse.data.response_score;
  if (parse.data.rubric !== undefined) updateData.rubric = parse.data.rubric;
  if (parse.data.answered !== undefined) {
    updateData.answered_at = parse.data.answered ? new Date().toISOString() : null;
  }

  const { data, error } = await supabase
    .from('interview_questions')
    .update(updateData)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ question: data });
}
