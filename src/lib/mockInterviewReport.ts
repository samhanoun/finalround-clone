import { z } from 'zod';

const ReportDimensionSchema = z.object({
  score: z.number().min(1).max(5),
  evidence: z.string().default(''),
  recommendation: z.string().default(''),
});

const RubricSchema = z.object({
  communication: ReportDimensionSchema,
  technical_accuracy: ReportDimensionSchema,
  problem_solving: ReportDimensionSchema,
  structure: ReportDimensionSchema,
  ownership: ReportDimensionSchema,
  role_fit: ReportDimensionSchema,
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

function normalizeDimension(input: unknown) {
  const maybe = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  return {
    score: clampScore(maybe.score),
    evidence: typeof maybe.evidence === 'string' ? maybe.evidence : '',
    recommendation: typeof maybe.recommendation === 'string' ? maybe.recommendation : '',
  };
}

export function fallbackMockInterviewReport(mode: string): MockInterviewReport {
  const report = {
    version: 'v1' as const,
    mode,
    overall_score: 64,
    hiring_signal: 'lean_no_hire' as const,
    summary: 'Candidate stayed engaged and showed baseline competency, with room to improve depth and structure.',
    strengths: ['Stayed engaged and completed the full mock interview.'],
    weaknesses: ['Answers need tighter structure and stronger role-specific examples.'],
    next_steps: ['Practice concise STAR responses and measurable outcomes for core role questions.'],
    rubric: {
      communication: { score: 3, evidence: '', recommendation: 'Tighten verbal structure and reduce filler.' },
      technical_accuracy: { score: 3, evidence: '', recommendation: 'Use more precise terminology and validation details.' },
      problem_solving: { score: 3, evidence: '', recommendation: 'Make reasoning explicit and compare alternatives.' },
      structure: { score: 2, evidence: '', recommendation: 'Lead with an answer, then support with 2-3 points.' },
      ownership: { score: 3, evidence: '', recommendation: 'Quantify personal impact and decision-making scope.' },
      role_fit: { score: 3, evidence: '', recommendation: 'Map examples directly to job requirements.' },
    },
  };

  return report;
}

export function normalizeMockInterviewReport(input: unknown, mode: string): MockInterviewReport {
  const base = fallbackMockInterviewReport(mode);
  const maybe = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const maybeRubric = (typeof maybe.rubric === 'object' && maybe.rubric ? maybe.rubric : {}) as Record<string, unknown>;

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
    strengths: Array.isArray(maybe.strengths) ? maybe.strengths.filter((v): v is string => typeof v === 'string') : base.strengths,
    weaknesses: Array.isArray(maybe.weaknesses) ? maybe.weaknesses.filter((v): v is string => typeof v === 'string') : base.weaknesses,
    next_steps: Array.isArray(maybe.next_steps) ? maybe.next_steps.filter((v): v is string => typeof v === 'string') : base.next_steps,
    rubric: {
      communication: normalizeDimension(maybeRubric.communication),
      technical_accuracy: normalizeDimension(maybeRubric.technical_accuracy),
      problem_solving: normalizeDimension(maybeRubric.problem_solving),
      structure: normalizeDimension(maybeRubric.structure),
      ownership: normalizeDimension(maybeRubric.ownership),
      role_fit: normalizeDimension(maybeRubric.role_fit),
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
