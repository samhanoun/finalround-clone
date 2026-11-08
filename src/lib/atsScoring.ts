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

/** A suggestion as a code the page shows in the reader's language (the English is in `suggestions`). */
export type ATSTip =
  | { code: 'add_keywords' | 'add_more_keywords'; keywords: string[] }
  | { code: 'add_contact' | 'expand' };

export interface ATSResult {
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  keywordMatches: KeywordMatch[];
  suggestions: string[];
  tips: ATSTip[];
  formatIssues: string[];
}

// Common job keywords to look for
const COMMON_KEYWORDS = [
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

/** Capitalised words that are grammar or a posting's headings, not skills ("We", "Requirements"). */
const NOT_SKILLS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'are', 'will', 'this', 'that', 'these', 'those',
  'about', 'what', 'who', 'why', 'how', 'when', 'where', 'while', 'from', 'into', 'also', 'other',
  'all', 'any', 'each', 'more', 'most', 'some', 'such', 'including', 'join', 'help', 'work', 'apply',
  'requirements', 'responsibilities', 'qualifications', 'skills', 'benefits', 'perks', 'bonus', 'plus',
  'nice', 'must', 'strong', 'ability', 'knowledge', 'familiarity', 'preferred', 'required', 'minimum',
  'role', 'team', 'company', 'job', 'description', 'position', 'location', 'remote', 'salary',
  'overview', 'summary', 'duties', 'hiring',
]);

/**
 * Capitalised terms in a posting, whole: "TypeScript", "PostgreSQL", "Google Cloud".
 * A word's inner capitals stay part of it (never "Type" and "Script").
 */
const CAPITALISED_TERM = /\b[A-Z][A-Za-z0-9+#]*(?:\.[A-Za-z0-9]+)*(?:[ \t]+[A-Z][A-Za-z0-9+#]*(?:\.[A-Za-z0-9]+)*)*/g;

/**
 * Extract keywords from job description
 */
export function extractJobKeywords(jobDescription: string): string[] {
  const text = jobDescription.toLowerCase();
  const found: string[] = [];

  // Whole words or phrases only, as in the résumé: "sql" isn't in "postgresql", nor "ai" in "maintain".
  for (const keyword of COMMON_KEYWORDS) {
    if (countKeywordOccurrences(text, keyword) > 0) {
      found.push(keyword);
    }
  }

  // Also extract capitalized words and phrases (likely proper nouns/skills)
  for (const [match] of jobDescription.matchAll(CAPITALISED_TERM)) {
    const words = match.toLowerCase().split(/\s+/);
    while (words.length && NOT_SKILLS.has(words[0])) words.shift();
    const term = words.join(' ');
    if (term.length > 2 && !NOT_SKILLS.has(term) && !found.includes(term)) {
      found.push(term);
    }
  }

  return [...new Set(found)];
}

/**
 * Count keyword occurrences in resume text, ignoring case and not inside a longer word (unlike \b,
 * this also works for keywords such as "c++" or "c#"). A plain search: the keyword comes from the
 * job description, so no pattern is built from it.
 */
function countKeywordOccurrences(text: string, keyword: string): number {
  const needle = keyword.toLowerCase();
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    const end = at + needle.length;
    if (!isAsciiLetterOrDigit(haystack[at - 1]) && !isAsciiLetterOrDigit(haystack[end])) {
      count += 1;
      at = haystack.indexOf(needle, end);
    } else {
      at = haystack.indexOf(needle, at + 1);
    }
  }
  return count;
}

/** An ASCII letter or digit: what a keyword may not touch on either side. */
function isAsciiLetterOrDigit(char: string | undefined): boolean {
  return char !== undefined && ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9'));
}

/** Whether any character is outside ASCII (some ATS parsers mangle them). */
function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) return true;
  }
  return false;
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
  // Bounded parts (an address's local part is at most 64 characters, a domain label 63), so a long
  // run of text with no address is checked in linear time: the server runs this on uploaded résumés,
  // and the unbounded pattern took time growing with the square of such a run.
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- bounded and linear, as above; a test checks 200,000 characters
  const hasContactInfo = /[\w.-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})+/.test(resumeText);
  const lowerText = resumeText.toLowerCase();
  const mentionsAny = (words: string[]) => words.some((word) => lowerText.includes(word));
  const hasExperience = mentionsAny(['experience', 'worked', 'employed', 'position', 'role']);
  const hasEducation = mentionsAny(['education', 'degree', 'bachelor', 'master', 'university', 'college']);
  const formatScore = (hasContactInfo ? 5 : 0) + (hasExperience ? 5 : 0) + (hasEducation ? 5 : 0);

  const totalScore = Math.round(keywordScore + lengthScore + formatScore);

  // Generate suggestions
  const suggestions: string[] = [];
  const tips: ATSTip[] = [];
  if (missingKeywords.length > 0 && missingKeywords.length <= 5) {
    suggestions.push(`Add these keywords: ${missingKeywords.slice(0, 5).join(', ')}`);
    tips.push({ code: 'add_keywords', keywords: missingKeywords.slice(0, 5) });
  } else if (missingKeywords.length > 5) {
    suggestions.push(`Add more keywords from the job description (${missingKeywords.slice(0, 5).join(', ')}...)`);
    tips.push({ code: 'add_more_keywords', keywords: missingKeywords.slice(0, 5) });
  }
  if (!hasContactInfo) {
    suggestions.push('Add contact information (email, phone)');
    tips.push({ code: 'add_contact' });
  }
  if (wordCount < 200) {
    suggestions.push('Consider expanding your resume content');
    tips.push({ code: 'expand' });
  }

  // Check for format issues
  const formatIssues: string[] = [];
  if (resumeText.length > 8000) {
    formatIssues.push('Resume may be too long for some ATS systems');
  }
  if (hasNonAscii(resumeText)) {
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
    tips,
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
