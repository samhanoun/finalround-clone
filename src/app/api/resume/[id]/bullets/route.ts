import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { analyzeBullets, rewriteBullet, getSuggestedVerbs } from '@/lib/bulletRewriter';

const BodySchema = z.object({
  bullets: z.array(z.string()).min(1),
  rewrite: z.boolean().default(false),
  context: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `resume_bullets:post:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Verify document ownership
  const { error: docError } = await supabase
    .from('resume_documents')
    .select('id, user_id')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .single();

  if (docError) {
    if (docError.code === 'PGRST116') {
      return jsonError(404, 'document_not_found');
    }
    return jsonError(500, 'db_error', docError);
  }

  // Analyze bullets
  const analyses = analyzeBullets(parse.data.bullets);
  
  // If rewrite is requested, also provide rewritten versions
  const results = analyses.map((analysis) => ({
    original: analysis.original,
    score: analysis.score,
    issues: analysis.issues,
    suggestions: analysis.suggestions,
    rewritten: parse.data.rewrite ? rewriteBullet(analysis.original) : undefined,
  }));

  // Get suggested verbs for context
  const suggestedVerbs = getSuggestedVerbs(parse.data.context);

  return NextResponse.json({
    analyses: results,
    suggestedVerbs,
    summary: {
      averageScore: results.reduce((sum, r) => sum + r.score, 0) / results.length,
      needsImprovement: results.filter((r) => r.score < 70).length,
      good: results.filter((r) => r.score >= 70).length,
    },
  });
}
