import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

const CreateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.string().min(1).max(50).optional(),
  meta: z.record(z.any()).optional(),
});

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `interviews:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('interviews')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ interviews: data });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `interviews:post:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('interviews')
    .insert({
      user_id: userData.user.id,
      title: parse.data.title ?? 'Interview',
      status: parse.data.status ?? 'draft',
      meta: parse.data.meta ?? {},
    })
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ interview: data }, { status: 201 });
}
