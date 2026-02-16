import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

const CreateSchema = z.object({
  score: z.number().optional(),
  rubric: z.record(z.string(), z.any()).optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_score:post:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const parse = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('interview_session_feedback')
    .insert({
      session_id: id,
      user_id: userData.user.id,
      score: parse.data.score ?? null,
      rubric: parse.data.rubric ?? {},
      notes: parse.data.notes ?? null,
    })
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ feedback: data }, { status: 201 });
}
