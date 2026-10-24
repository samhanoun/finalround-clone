/**
 * Cover Letter Generation Service
 * 
 * Generates personalized cover letters based on:
 * - Job description content
 * - Resume content alignment
 * - Tone customization
 */

import { completeChat, extractJsonObject, practiceModel } from './practice/practice';
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
  /** 0–100, or null when the model gave none. */
  alignmentScore: number | null;
}

/** Marks the task for the e2e fake model. */
export const TASK_COVER_LETTER = 'TASK: cover_letter';

/**
 * Writes a cover letter from the job and the résumé, with the job keywords the
 * résumé covers and a 0–100 fit score (null when the model gives none).
 */
export async function generateCoverLetter(input: CoverLetterInput): Promise<CoverLetterOutput> {
  const system = [
    TASK_COVER_LETTER,
    'You write cover letters for job applicants. The letter must:',
    `- use this tone: ${getToneGuidance(input.tone)}`,
    '- connect specific achievements from the résumé to what the job asks for;',
    '- be three or four short paragraphs: why this role, two pieces of evidence, a confident close;',
    '- avoid clichés ("I am writing to apply", "team player", "passionate") and anything not supported by the résumé.',
    'Never invent employers, titles, numbers or skills.',
    'Reply with JSON only, in this shape:',
    '{"letter":"...","matched_keywords":["..."],"alignment_score":0}',
    'matched_keywords: job requirements the résumé clearly shows. alignment_score: 0–100, how well the résumé fits the job.',
  ].join('\n');

  const user = [
    `Position: ${input.jobTitle}`,
    `Company: ${input.companyName}`,
    input.userName ? `Candidate name: ${input.userName}` : '',
    '',
    'Job description:',
    input.jobDescription,
    '',
    'Résumé:',
    input.resumeContent,
    input.additionalContext ? `\nAlso mention: ${input.additionalContext}` : '',
  ].join('\n');

  const reply = await completeChat({
    model: practiceModel(),
    system: [system],
    messages: [{ role: 'user', content: user }],
    temperature: 0.6,
    maxTokens: 1_400,
    timeoutMs: 60_000,
  });
  return parseCoverLetterReply(reply);
}

/** Reads the model's JSON; a plain-text reply is taken as the letter itself. */
export function parseCoverLetterReply(reply: string): CoverLetterOutput {
  const raw = extractJsonObject(reply) as { letter?: unknown; matched_keywords?: unknown; alignment_score?: unknown } | null;
  if (raw && typeof raw.letter === 'string' && raw.letter.trim()) {
    const score = Number(raw.alignment_score);
    return {
      content: raw.letter.trim(),
      matchedKeywords: Array.isArray(raw.matched_keywords)
        ? raw.matched_keywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '').map((k) => k.trim()).slice(0, 20)
        : [],
      alignmentScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    };
  }
  return { content: reply.trim(), matchedKeywords: [], alignmentScore: null };
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
