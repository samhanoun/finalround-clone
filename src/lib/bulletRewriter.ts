/**
 * Bullet point rewriting for resume optimization
 * Helps transform weak bullet points into impactful achievement statements
 */

export interface BulletAnalysis {
  original: string;
  score: number;
  issues: string[];
  rewritten?: string;
  suggestions: string[];
}

/**
 * Common action verbs organized by category
 */
const ACTION_VERBS = {
  leadership: [
    'Led', 'Directed', 'Managed', 'Coordinated', 'Spearheaded',
    'Championed', 'Mentored', 'Coached', 'Supervised', 'Oversaw',
  ],
  achievement: [
    'Achieved', 'Exceeded', 'Delivered', 'Implemented', 'Optimized',
    'Reduced', 'Increased', 'Improved', 'Transformed', 'Established',
  ],
  technical: [
    'Developed', 'Built', 'Designed', 'Architected', 'Engineered',
    'Integrated', 'Deployed', 'Maintained', 'Debugged', 'Automated',
  ],
  communication: [
    'Presented', 'Communicated', 'Collaborated', 'Negotiated',
    'Facilitated', 'Influenced', 'Explained', 'Documented',
  ],
  analytical: [
    'Analyzed', 'Evaluated', 'Assessed', 'Investigated', 'Identified',
    'Measured', 'Tracked', 'Reported', 'Forecasted', 'Modeled',
  ],
};

/**
 * Words to avoid in bullet points (weak language)
 */
const WEAK_WORDS = [
  'helped', 'assisted', 'tried', 'worked on', 'responsible for',
  'duties included', 'stuff', 'things', 'nice', 'good', 'great',
  'pretty', 'kind of', 'sort of', 'maybe', 'might', 'could',
];

const STRONG_METRICS = [
  'percentage', '%', 'dollar', '$', 'revenue', 'cost', 'time',
  'hours', 'days', 'users', 'customers', 'clients', 'leads',
  'sales', 'performance', 'efficiency', 'productivity',
];

/**
 * Analyze a bullet point and provide improvement suggestions
 */
export function analyzeBullet(bullet: string): BulletAnalysis {
  const trimmed = bullet.trim();
  const lower = trimmed.toLowerCase();

  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 50; // Base score

  // Check for weak words
  for (const weak of WEAK_WORDS) {
    if (lower.includes(weak)) {
      issues.push(`Contains weak word: "${weak}"`);
      score -= 10;
    }
  }

  // Check for metrics/quantification
  const hasMetrics = STRONG_METRICS.some((m) => lower.includes(m));
  if (!hasMetrics) {
    issues.push('Missing quantifiable metrics');
    suggestions.push('Add numbers, percentages, or specific outcomes');
    score -= 15;
  } else {
    score += 15;
  }

  // Check for action verbs
  const hasActionVerb = Object.values(ACTION_VERBS)
    .flat()
    .some((verb) => lower.startsWith(verb.toLowerCase()));
  
  if (!hasActionVerb) {
    issues.push('Should start with a strong action verb');
    suggestions.push('Begin with a powerful action verb like: Led, Achieved, Developed, etc.');
    score -= 15;
  } else {
    score += 15;
  }

  // Check length
  if (trimmed.length < 20) {
    issues.push('Too short - lacks detail');
    score -= 10;
  } else if (trimmed.length > 150) {
    issues.push('Too long - should be more concise');
    score -= 10;
  } else {
    score += 10;
  }

  // Check for passive voice
  if (/was|were|been|being/.test(lower) && !/\bby\b/.test(lower)) {
    issues.push('May use passive voice');
    suggestions.push('Use active voice instead of passive');
    score -= 10;
  }

  // Check for jargon/complexity
  if (/\butilized\b|\bleverage\b|\boptimize\b/i.test(lower)) {
    suggestions.push('Consider simpler language - avoid jargon');
  }

  return {
    original: trimmed,
    score: Math.max(0, Math.min(100, score)),
    issues,
    suggestions,
  };
}

/**
 * Rewrite a bullet point with improvements
 */
export function rewriteBullet(bullet: string): string {
  const analysis = analyzeBullet(bullet);
  const trimmed = bullet.trim();
  
  // If already good, return as-is
  if (analysis.score >= 80) {
    return trimmed;
  }

  let rewritten = trimmed;

  // Try to add metrics if missing
  if (!STRONG_METRICS.some((m) => trimmed.toLowerCase().includes(m))) {
    const metrics = '[Add metrics: %, $, # users, time saved, etc.]';
    if (!rewritten.endsWith(metrics)) {
      rewritten = `${rewritten} ${metrics}`;
    }
  }

  // If starts with weak word, suggest action verb
  const lower = trimmed.toLowerCase();
  for (const weak of WEAK_WORDS) {
    if (lower.startsWith(weak)) {
      // Find a suitable replacement based on context
      const context = lower.includes('team') ? 'leadership' :
                     lower.includes('code') || lower.includes('develop') ? 'technical' :
                     lower.includes('analyze') || lower.includes('data') ? 'analytical' :
                     'achievement';
      
      const verbs = ACTION_VERBS[context as keyof typeof ACTION_VERBS];
      if (verbs && verbs.length > 0) {
        const firstWord = trimmed.split(' ')[0];
        rewritten = trimmed.replace(firstWord, verbs[0]);
      }
      break;
    }
  }

  // If no action verb at start, add one
  if (!Object.values(ACTION_VERBS).flat().some((v) => lower.startsWith(v.toLowerCase()))) {
    rewritten = `Delivered ${rewritten.charAt(0).toLowerCase()}${rewritten.slice(1)}`;
  }

  return rewritten;
}

/**
 * Analyze multiple bullet points
 */
export function analyzeBullets(bullets: string[]): BulletAnalysis[] {
  return bullets.map(analyzeBullet);
}

/**
 * Get suggested action verbs based on context
 */
export function getSuggestedVerbs(context?: string): string[] {
  if (context && context in ACTION_VERBS) {
    return ACTION_VERBS[context as keyof typeof ACTION_VERBS];
  }
  return Object.values(ACTION_VERBS).flat();
}
