import { z } from 'zod';

const ReportDimensionSchema = z.object({
  score: z.number().min(1).max(5),
  evidence: z.string().default(''),
  recommendation: z.string().default(''),
});

// PRD-aligned rubric: clarity, confidence, relevance, structure
const RubricSchema = z.object({
  clarity: ReportDimensionSchema,
  confidence: ReportDimensionSchema,
  relevance: ReportDimensionSchema,
  structure: ReportDimensionSchema,
});

export const MockInterviewReportSchema = z.object({
  version: z.literal('v1').default('v1'),
  mode: z.string().default('general'),
  overall_score: z.number().min(0).max(100),
  hiring_signal: z.enum(['strong_no_hire', 'no_hire', 'lean_no_hire', 'lean_hire', 'hire', 'strong_hire']),
  summary: z.string().default(''),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
  rubric: RubricSchema,
});

export type MockInterviewReport = z.infer<typeof MockInterviewReportSchema>;

function clampScore(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function normalizeDimension(input: unknown, fallback: z.infer<typeof ReportDimensionSchema>) {
  const maybe = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  return {
    score: clampScore(maybe.score ?? fallback.score),
    evidence: typeof maybe.evidence === 'string' ? maybe.evidence : fallback.evidence,
    recommendation: typeof maybe.recommendation === 'string' ? maybe.recommendation : fallback.recommendation,
  };
}

function normalizeStringList(input: unknown, maxItems = 8): string[] {
  if (!Array.isArray(input)) return [];

  const unique = new Set<string>();

  for (const item of input) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim();
    if (!cleaned) continue;
    unique.add(cleaned);
    if (unique.size >= maxItems) break;
  }

  return Array.from(unique);
}

function ensureMinimumItems(input: string[], fallback: string[], minimum: number): string[] {
  const merged = [...input];

  for (const fallbackItem of fallback) {
    if (merged.length >= minimum) break;
    if (!merged.includes(fallbackItem)) merged.push(fallbackItem);
  }

  return merged.slice(0, Math.max(minimum, merged.length));
}

function applyPriorityOrder(items: string[]): string[] {
  return items.map((item, index) => {
    const unlabeled = item.replace(/^P\d+\s*[:\-]\s*/i, '').trim();
    return `P${index + 1}: ${unlabeled}`;
  });
}

export function fallbackMockInterviewReport(mode: string): MockInterviewReport {
  const report = {
    version: 'v1' as const,
    mode,
    overall_score: 64,
    hiring_signal: 'lean_no_hire' as const,
    summary: 'Candidate stayed engaged and showed baseline competency, with room to improve clarity, confidence, relevance, and structure.',
    strengths: [
      'Stayed engaged and completed the full mock interview.',
      'Communicated clearly enough to keep answers understandable.',
      'Provided relevant examples that addressed the questions.',
    ],
    weaknesses: [
      'Answers need tighter structure and clearer organization.',
      'Confidence could be improved with more concrete examples.',
      'Relevance to role requirements could be stronger.',
    ],
    next_steps: [
      'P1: Practice structured responses using STAR or similar frameworks.',
      'P2: Prepare quantified impact stories aligned to target role requirements.',
      'P3: Rehearse answers to build confidence and reduce hesitation.',
    ],
    rubric: {
      clarity: { score: 3, evidence: '', recommendation: 'Speak more clearly and avoid filler words.' },
      confidence: { score: 3, evidence: '', recommendation: 'Project more confidence through tone and pacing.' },
      relevance: { score: 3, evidence: '', recommendation: 'Ensure answers directly address the question asked.' },
      structure: { score: 2, evidence: '', recommendation: 'Lead with an answer, then support with 2-3 organized points.' },
    },
  };

  return report;
}

export function normalizeMockInterviewReport(input: unknown, mode: string): MockInterviewReport {
  const base = fallbackMockInterviewReport(mode);
  const maybe = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const maybeRubric = (typeof maybe.rubric === 'object' && maybe.rubric ? maybe.rubric : {}) as Record<string, unknown>;

  const strengths = ensureMinimumItems(normalizeStringList(maybe.strengths), base.strengths, 3);
  const weaknesses = ensureMinimumItems(normalizeStringList(maybe.weaknesses), base.weaknesses, 3);
  const nextSteps = applyPriorityOrder(ensureMinimumItems(normalizeStringList(maybe.next_steps), base.next_steps, 3));

  const normalized = {
    version: 'v1' as const,
    mode,
    overall_score:
      typeof maybe.overall_score === 'number' && !Number.isNaN(maybe.overall_score)
        ? Math.max(0, Math.min(100, Math.round(maybe.overall_score)))
        : base.overall_score,
    hiring_signal:
      maybe.hiring_signal === 'strong_no_hire' ||
      maybe.hiring_signal === 'no_hire' ||
      maybe.hiring_signal === 'lean_no_hire' ||
      maybe.hiring_signal === 'lean_hire' ||
      maybe.hiring_signal === 'hire' ||
      maybe.hiring_signal === 'strong_hire'
        ? maybe.hiring_signal
        : base.hiring_signal,
    summary: typeof maybe.summary === 'string' ? maybe.summary : base.summary,
    strengths,
    weaknesses,
    next_steps: nextSteps,
    rubric: {
      clarity: normalizeDimension(maybeRubric.clarity, base.rubric.clarity),
      confidence: normalizeDimension(maybeRubric.confidence, base.rubric.confidence),
      relevance: normalizeDimension(maybeRubric.relevance, base.rubric.relevance),
      structure: normalizeDimension(maybeRubric.structure, base.rubric.structure),
    },
  };

  return MockInterviewReportSchema.parse(normalized);
}

export function reportToLegacyPayload(report: MockInterviewReport) {
  return {
    mode: report.mode,
    strengths: report.strengths,
    weaknesses: report.weaknesses,
    next_steps: report.next_steps,
    report,
  };
}
