/**
 * ATS (Applicant Tracking System) scoring and keyword optimization
 * This module provides functions to analyze resumes against job descriptions
 */

export interface KeywordMatch {
  keyword: string;
  found: boolean;
  frequency: number;
  context?: string;
}

export interface ATSResult {
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  keywordMatches: KeywordMatch[];
  suggestions: string[];
  formatIssues: string[];
}

/**
 * Extract keywords from job description
 */
export function extractJobKeywords(jobDescription: string): string[] {
  // Common job keywords to look for
  const commonKeywords = [
    // Technical skills
    'javascript', 'typescript', 'python', 'java', 'react', 'angular', 'vue',
    'node.js', 'express', 'next.js', 'sql', 'postgresql', 'mongodb', 'redis',
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'git', 'ci/cd',
    'machine learning', 'ai', 'data science', 'analytics',
    'rest api', 'graphql', 'microservices', 'agile', 'scrum',
    // Soft skills
    'leadership', 'communication', 'teamwork', 'problem-solving',
    'project management', 'collaboration', 'analytical',
    // General
    'experience', 'years', 'senior', 'junior', 'mid-level', 'principal',
    'architecture', 'design', 'implementation', 'optimization',
  ];

  const text = jobDescription.toLowerCase();
  const found: string[] = [];

  for (const keyword of commonKeywords) {
    if (text.includes(keyword)) {
      found.push(keyword);
    }
  }

  // Also extract capitalized words and phrases (likely proper nouns/skills)
  const capitalizedMatches = jobDescription.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  for (const match of capitalizedMatches) {
    const lower = match.toLowerCase();
    if (lower.length > 2 && !found.includes(lower) && !commonKeywords.includes(lower)) {
      found.push(lower);
    }
  }

  return [...new Set(found)];
}

/**
 * Count keyword occurrences in resume text
 */
function countKeywordOccurrences(text: string, keyword: string): number {
  const regex = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calculate ATS score based on job description match
 */
export function calculateATSScore(
  resumeText: string,
  jobDescription: string
): ATSResult {
  const jobKeywords = extractJobKeywords(jobDescription);
  const resumeTextLower = resumeText.toLowerCase();

  const keywordMatches: KeywordMatch[] = [];
  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const keyword of jobKeywords) {
    const frequency = countKeywordOccurrences(resumeTextLower, keyword);
    const found = frequency > 0;

    keywordMatches.push({
      keyword,
      found,
      frequency,
    });

    if (found) {
      matchedKeywords.push(keyword);
    } else {
      missingKeywords.push(keyword);
    }
  }

  // Calculate score (0-100)
  const keywordScore = jobKeywords.length > 0
    ? (matchedKeywords.length / jobKeywords.length) * 70
    : 0;

  // Bonus for having relevant content length
  const wordCount = resumeText.split(/\s+/).length;
  const lengthScore = wordCount > 200 ? 15 : (wordCount / 200) * 15;

  // Format bonus (presence of common resume sections)
  const hasContactInfo = /[\w.-]+@[\w.-]+\.\w+/.test(resumeText);
  const hasExperience = /experience|worked|employed|position|role/i.test(resumeText);
  const hasEducation = /education|degree|bachelor|master|university|college/i.test(resumeText);
  const formatScore = (hasContactInfo ? 5 : 0) + (hasExperience ? 5 : 0) + (hasEducation ? 5 : 0);

  const totalScore = Math.round(keywordScore + lengthScore + formatScore);

  // Generate suggestions
  const suggestions: string[] = [];
  if (missingKeywords.length > 0 && missingKeywords.length <= 5) {
    suggestions.push(`Add these keywords: ${missingKeywords.slice(0, 5).join(', ')}`);
  } else if (missingKeywords.length > 5) {
    suggestions.push(`Add more keywords from the job description (${missingKeywords.slice(0, 5).join(', ')}...)`);
  }
  if (!hasContactInfo) {
    suggestions.push('Add contact information (email, phone)');
  }
  if (wordCount < 200) {
    suggestions.push('Consider expanding your resume content');
  }

  // Check for format issues
  const formatIssues: string[] = [];
  if (resumeText.length > 8000) {
    formatIssues.push('Resume may be too long for some ATS systems');
  }
  if (/[^\x00-\x7F]/.test(resumeText)) {
    formatIssues.push('Contains special characters that may cause parsing issues');
  }
  if (!hasContactInfo) {
    formatIssues.push('Missing contact information');
  }

  return {
    score: Math.min(totalScore, 100),
    matchedKeywords,
    missingKeywords,
    keywordMatches,
    suggestions,
    formatIssues,
  };
}

/**
 * Suggest keywords to add to resume based on job description
 */
export function suggestKeywords(
  resumeText: string,
  jobDescription: string
): string[] {
  const jobKeywords = extractJobKeywords(jobDescription);
  const resumeTextLower = resumeText.toLowerCase();

  return jobKeywords.filter((keyword) => {
    const frequency = countKeywordOccurrences(resumeTextLower, keyword);
    return frequency === 0;
  });
}
