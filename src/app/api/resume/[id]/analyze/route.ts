import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { calculateATSScore, suggestKeywords } from '@/lib/atsScoring';

const BodySchema = z.object({
  jobDescription: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `resume_analyze:post:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Get the resume document
  const { data: doc, error: docError } = await supabase
    .from('resume_documents')
    .select('id, user_id, parsed_text, keywords')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .single();

  if (docError) {
    if (docError.code === 'PGRST116') {
      return jsonError(404, 'document_not_found');
    }
    return jsonError(500, 'db_error', docError);
  }

  if (!doc.parsed_text) {
    return jsonError(400, 'document_not_parsed', 'Please upload a document first or wait for parsing to complete');
  }

  // Calculate ATS score
  const atsResult = calculateATSScore(doc.parsed_text, parse.data.jobDescription);
  
  // Get suggested keywords
  const suggested = suggestKeywords(doc.parsed_text, parse.data.jobDescription);

  // Update the document with ATS score and keywords
  await supabase
    .from('resume_documents')
    .update({
      ats_score: atsResult.score,
      keywords: atsResult.matchedKeywords,
    })
    .eq('id', id);

  // Also update the generations table with this analysis if needed
  // For now, return the analysis directly

  return NextResponse.json({
    atsScore: atsResult.score,
    matchedKeywords: atsResult.matchedKeywords,
    missingKeywords: atsResult.missingKeywords,
    keywordMatches: atsResult.keywordMatches,
    suggestions: atsResult.suggestions,
    formatIssues: atsResult.formatIssues,
    suggestedKeywords: suggested,
  });
}
