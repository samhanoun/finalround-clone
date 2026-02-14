import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

const CreateRunSchema = z.object({
  assetId: z.string().uuid().optional(),
  input: z.record(z.string(), z.any()).default({}),
});

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `resume:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('resume_runs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ runs: data });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `resume:post:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = CreateRunSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { data, error } = await supabase
    .from('resume_runs')
    .insert({
      user_id: userData.user.id,
      asset_id: parse.data.assetId ?? null,
      status: 'queued',
      input: parse.data.input,
      output: {},
    })
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ run: data }, { status: 201 });
}
