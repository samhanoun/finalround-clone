import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { generateCoverLetter, saveCoverLetter, getUserCoverLetters } from '@/lib/coverLetter';
import { LLMUnavailableError } from '@/lib/llmRouter';

// Validation schema for generating a cover letter
const GenerateSchema = z.object({
  jobTitle: z.string().min(1, 'Job title is required'),
  companyName: z.string().min(1, 'Company name is required'),
  jobDescription: z.string().min(50, 'Job description must be at least 50 characters'),
  // The résumé as text, or one of the user's parsed résumés (read here).
  resumeContent: z.string().min(50, 'Resume content must be at least 50 characters').optional(),
  resumeDocumentId: z.string().uuid().optional(),
  tone: z.enum(['professional', 'friendly', 'formal', 'casual', 'confident']).default('professional'),
  userName: z.string().optional(),
  additionalContext: z.string().optional(),
  jobId: z.string().uuid().optional(),
  resumeId: z.string().uuid().optional(),
  save: z.boolean().default(true),
});

/**
 * GET /api/cover-letters
 * List all cover letters for the authenticated user
 */
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `cover_letters:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  try {
    const coverLetters = await getUserCoverLetters(userData.user.id);
    return NextResponse.json({ cover_letters: coverLetters });
  } catch (error) {
    console.error('Failed to fetch cover letters:', error);
    return jsonError(500, 'fetch_failed', { message: 'Failed to fetch cover letters' });
  }
}

/**
 * POST /api/cover-letters
 * Generate a new cover letter
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `cover_letters:post:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = GenerateSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) {
    return jsonError(400, 'invalid_body', parse.error.flatten());
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const input = parse.data;

  let resumeContent = input.resumeContent;
  if (!resumeContent && input.resumeDocumentId) {
    const { data: doc } = await supabase
      .from('resume_documents')
      .select('id, user_id, parsed_text')
      .eq('id', input.resumeDocumentId)
      .maybeSingle<{ id: string; user_id: string; parsed_text: string | null }>();
    if (!doc || doc.user_id !== userData.user.id) return jsonError(404, 'resume_not_found');
    if (!doc.parsed_text?.trim()) return jsonError(422, 'resume_not_parsed');
    resumeContent = doc.parsed_text;
  }
  if (!resumeContent) return jsonError(400, 'resume_required');

  try {
    // Generate the cover letter
    const result = await generateCoverLetter({
      jobTitle: input.jobTitle,
      companyName: input.companyName,
      jobDescription: input.jobDescription,
      resumeContent,
      tone: input.tone,
      userName: input.userName,
      additionalContext: input.additionalContext,
    });

    // Save to database if requested
    let savedCoverLetter = null;
    if (input.save) {
      savedCoverLetter = await saveCoverLetter(userData.user.id, {
        jobId: input.jobId,
        resumeId: input.resumeId,
        title: `${input.jobTitle} - ${input.companyName}`,
        content: result.content,
        tone: input.tone,
        status: 'generated',
        metadata: {
          matchedKeywords: result.matchedKeywords,
          alignmentScore: result.alignmentScore,
          jobTitle: input.jobTitle,
          companyName: input.companyName,
          ...(input.resumeDocumentId ? { resume_document_id: input.resumeDocumentId } : {}),
        },
      });
    }

    return NextResponse.json({
      cover_letter: savedCoverLetter ?? {
        content: result.content,
        tone: input.tone,
        matched_keywords: result.matchedKeywords,
        alignment_score: result.alignmentScore,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof LLMUnavailableError) return jsonError(503, 'llm_unavailable');
    console.error('Cover letter generation failed:', error);
    return jsonError(500, 'generation_failed', { 
      message: error instanceof Error ? error.message : 'Failed to generate cover letter' 
    });
  }
}
