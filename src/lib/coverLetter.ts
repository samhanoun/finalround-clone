/**
 * Cover Letter Generation Service
 * 
 * Generates personalized cover letters based on:
 * - Job description content
 * - Resume content alignment
 * - Tone customization
 */

import OpenAI from 'openai';
import { requireEnv } from './env';
import { createAdminClient } from './supabase/admin';

export type CoverLetterTone = 'professional' | 'friendly' | 'formal' | 'casual' | 'confident';

export interface CoverLetterInput {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  resumeContent: string;
  tone: CoverLetterTone;
  userName?: string;
  additionalContext?: string;
}

export interface CoverLetterOutput {
  content: string;
  matchedKeywords: string[];
  alignmentScore: number;
}

/**
 * Generate a cover letter based on job description and resume content
 */
export async function generateCoverLetter(input: CoverLetterInput): Promise<CoverLetterOutput> {
  const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
  
  const toneGuidance = getToneGuidance(input.tone);
  
  const systemPrompt = `You are an expert career coach and cover letter writer. Your task is to write compelling, personalized cover letters that:
1. Align the candidate's experience with the job requirements
2. Use an appropriate tone: ${toneGuidance}
3. Highlight specific achievements and skills from the resume
4. Demonstrate genuine interest in the company and role
5. Follow standard cover letter structure (introduction, body, conclusion)

Guidelines:
- Keep the cover letter to 3-4 paragraphs
- Use concrete examples from the resume
- Avoid generic phrases
- Focus on value the candidate can bring to the company
- Address the hiring manager directly when possible

Also extract and return:
- List of keywords from the job description that match the resume (matchedKeywords)
- A score from 0-100 indicating how well the resume aligns with the job description (alignmentScore)`;

  const userPrompt = `Please write a cover letter with the following details:

**Job Information:**
- Position: ${input.jobTitle}
- Company: ${input.companyName}
- Job Description:
${input.jobDescription}

**Candidate Resume:**
${input.resumeContent}

${input.userName ? `**Candidate Name:** ${input.userName}` : ''}
${input.additionalContext ? `\n**Additional Context:** ${input.additionalContext}` : ''}

**Tone:** ${input.tone}

Please provide the cover letter followed by:
- matchedKeywords: [list of matching keywords]
- alignmentScore: [number 0-100]`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content ?? '';
    
    // Parse the response to extract cover letter and metadata
    const parsed = parseCoverLetterResponse(response);
    
    return parsed;
  } catch (error) {
    console.error('Cover letter generation failed:', error);
    throw new Error('Failed to generate cover letter');
  }
}

/**
 * Parse LLM response to extract cover letter content and metadata
 */
function parseCoverLetterResponse(response: string): CoverLetterOutput {
  // Extract matched keywords
  const keywordsMatch = response.match(/matchedKeywords:\s*\[(.*?)\]/i);
  const keywords = keywordsMatch 
    ? keywordsMatch[1].split(',').map(k => k.trim().replace(/["']/g, '')).filter(Boolean)
    : [];
  
  // Extract alignment score
  const scoreMatch = response.match(/alignmentScore:\s*(\d+)/i);
  const alignmentScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 50;
  
  // Extract cover letter content (everything before matchedKeywords or at the end)
  const content = response.replace(/matchedKeywords:.*$/gim, '').replace(/alignmentScore:.*$/gim, '').trim();
  
  return {
    content,
    matchedKeywords: keywords,
    alignmentScore: Math.min(100, Math.max(0, alignmentScore)),
  };
}

/**
 * Get tone-specific guidance for the LLM
 */
export function getToneGuidance(tone: CoverLetterTone): string {
  const guidance: Record<CoverLetterTone, string> = {
    professional: 'Use a polished, business-appropriate tone. Be direct and concise. Focus on qualifications and fit.',
    friendly: 'Use a warm, approachable tone. Show enthusiasm and personality while remaining professional.',
    formal: 'Use a highly professional and traditional tone. Be respectful and ceremonial in language.',
    casual: 'Use a relaxed, conversational tone. Be personable while still conveying important information.',
    confident: 'Use a strong, assertive tone. Highlight achievements boldly and show self-assurance.',
  };
  return guidance[tone] || guidance.professional;
}

/**
 * Save a cover letter to the database
 */
export async function saveCoverLetter(
  userId: string,
  data: {
    jobId?: string;
    resumeId?: string;
    title?: string;
    content: string;
    tone: CoverLetterTone;
    status?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const admin = createAdminClient();
  
  const { data: coverLetter, error } = await admin
    .from('cover_letters')
    .insert({
      user_id: userId,
      job_id: data.jobId ?? null,
      resume_id: data.resumeId ?? null,
      title: data.title ?? 'Cover Letter',
      content: data.content,
      tone: data.tone,
      status: data.status ?? 'generated',
      metadata: data.metadata ?? {},
    })
    .select('*')
    .single();
  
  if (error) {
    console.error('Failed to save cover letter:', error);
    throw new Error('Failed to save cover letter');
  }
  
  return coverLetter;
}

/**
 * Get user's cover letters
 */
export async function getUserCoverLetters(userId: string) {
  const admin = createAdminClient();
  
  const { data, error } = await admin
    .from('cover_letters')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Failed to fetch cover letters:', error);
    throw new Error('Failed to fetch cover letters');
  }
  
  return data;
}

/**
 * Get a single cover letter by ID
 */
export async function getCoverLetter(userId: string, coverLetterId: string) {
  const admin = createAdminClient();
  
  const { data, error } = await admin
    .from('cover_letters')
    .select('*')
    .eq('id', coverLetterId)
    .eq('user_id', userId)
    .single();
  
  if (error) {
    console.error('Failed to fetch cover letter:', error);
    throw new Error('Cover letter not found');
  }
  
  return data;
}

/**
 * Update a cover letter
 */
export async function updateCoverLetter(
  userId: string,
  coverLetterId: string,
  data: {
    title?: string;
    content?: string;
    tone?: CoverLetterTone;
    status?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const admin = createAdminClient();
  
  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.tone !== undefined) updateData.tone = data.tone;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.metadata !== undefined) updateData.metadata = data.metadata;
  
  const { data: coverLetter, error } = await admin
    .from('cover_letters')
    .update(updateData)
    .eq('id', coverLetterId)
    .eq('user_id', userId)
    .select('*')
    .single();
  
  if (error) {
    console.error('Failed to update cover letter:', error);
    throw new Error('Failed to update cover letter');
  }
  
  return coverLetter;
}

/**
 * Delete a cover letter
 */
export async function deleteCoverLetter(userId: string, coverLetterId: string) {
  const admin = createAdminClient();
  
  const { error } = await admin
    .from('cover_letters')
    .delete()
    .eq('id', coverLetterId)
    .eq('user_id', userId);
  
  if (error) {
    console.error('Failed to delete cover letter:', error);
    throw new Error('Failed to delete cover letter');
  }
  
  return { success: true };
}
