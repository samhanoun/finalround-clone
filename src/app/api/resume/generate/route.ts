import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { checkQuota, recordUsage } from '@/lib/quota';

const BodySchema = z.object({
  documentId: z.string().uuid().optional(),
  input: z.record(z.string(), z.any()).default({}),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `resume_generate:post:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Check quota for deep reviews if this is a deep review request
  const isDeepReview = parse.data.input?.deep_review === true;
  if (isDeepReview) {
    const quota = await checkQuota(userData.user.id, 'resume_deep_reviews');
    if (!quota.allowed) {
      return jsonError(403, 'quota_exceeded', {
        type: 'resume_deep_reviews',
        used: quota.used,
        limit: quota.limit,
        message: 'Monthly resume deep reviews quota exceeded',
      });
    }
  }

  const { data, error } = await supabase
    .from('resume_generations')
    .insert({
      user_id: userData.user.id,
      document_id: parse.data.documentId ?? null,
      status: 'queued',
      input: parse.data.input,
      output: {},
    })
    .select('*')
    .single();

  if (error) return jsonError(500, 'db_error', error);
  
  // Record usage for deep reviews
  if (isDeepReview && data?.id) {
    await recordUsage(userData.user.id, 'resume_deep_reviews', 1, data.id);
  }
  
  return NextResponse.json({ generation: data }, { status: 201 });
}
