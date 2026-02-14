import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.string().min(1).max(50).optional(),
  meta: z.record(z.any()).optional(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `interviews:id:get:${ip}`, limit: 120, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('interviews')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return jsonError(404, 'not_found');
  return NextResponse.json({ interview: data });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `interviews:id:patch:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const parse = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('interviews')
    .update(parse.data)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ interview: data });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `interviews:id:del:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { error } = await supabase.from('interviews').delete().eq('id', id);
  if (error) return jsonError(500, 'db_error', error);

  return NextResponse.json({ ok: true });
}
