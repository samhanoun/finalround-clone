import { z } from 'zod';
import { HIRING_SIGNALS, LIVE_RUBRIC_KEYS, type HiringSignal, type LiveRubricKey } from '@/lib/copilot/reportRubric';

export { HIRING_SIGNALS, LIVE_RUBRIC_KEYS, type HiringSignal, type LiveRubricKey } from '@/lib/copilot/reportRubric';

/**
 * Interview reports, kept to what the model wrote. Nothing is filled in: a
 * list the model left empty stays empty, and an area it didn't score has no
 * score. A reply without an overall score isn't a report (null), so callers
 * save nothing. Two rubrics:
 * - the live copilot's session report: LIVE_RUBRIC_KEYS, the six areas the
 *   summarize prompt asks for and Past sessions shows ("not captured" when
 *   the model didn't score one);
 * - a practice interview's report: PRACTICE_RUBRIC_KEYS, the four areas its
 *   prompt asks for; an area the model didn't score is left out.
 */

export const PRACTICE_RUBRIC_KEYS = ['clarity', 'confidence', 'relevance', 'structure'] as const;
export type PracticeRubricKey = (typeof PRACTICE_RUBRIC_KEYS)[number];

/** One rubric area; `score` is null when the model didn't score it. */
const DimensionSchema = z.object({
  score: z.number().int().min(1).max(5).nullable(),
  evidence: z.string(),
  recommendation: z.string(),
});
export type ReportDimension = z.infer<typeof DimensionSchema>;

const ScoredDimensionSchema = DimensionSchema.extend({ score: z.number().int().min(1).max(5) });

const ReportBaseSchema = z.object({
  version: z.literal('v1'),
  mode: z.string(),
  overall_score: z.number().int().min(0).max(100),
  hiring_signal: z.enum(HIRING_SIGNALS).nullable(),
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  next_steps: z.array(z.string()),
});

/** The live copilot's session report: every one of the six areas, scored or not. */
export const MockInterviewReportSchema = ReportBaseSchema.extend({
  rubric: z.object(
    Object.fromEntries(LIVE_RUBRIC_KEYS.map((key) => [key, DimensionSchema])) as Record<LiveRubricKey, typeof DimensionSchema>,
  ),
});
export type MockInterviewReport = z.infer<typeof MockInterviewReportSchema>;

/** A practice interview's report: only the areas the model scored. */
export const PracticeReportSchema = ReportBaseSchema.extend({
  rubric: z.object({
    clarity: ScoredDimensionSchema.optional(),
    confidence: ScoredDimensionSchema.optional(),
    relevance: ScoredDimensionSchema.optional(),
    structure: ScoredDimensionSchema.optional(),
  }),
});
export type PracticeReport = z.infer<typeof PracticeReportSchema>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A number, or a number written as text ("4"); null for anything else. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const cleaned = item.trim();
    if (!cleaned) continue;
    unique.add(cleaned);
    if (unique.size >= maxItems) break;
  }
  return Array.from(unique);
}

/** Next steps in priority order: "P1: …", "P2: …", whatever labels the model used. */
function prioritized(items: string[]): string[] {
  return items.map((item, index) => `P${index + 1}: ${item.replace(/^P\d+\s*[:\-]\s*/i, '').trim()}`);
}

function overallScore(value: unknown): number | null {
  const score = asNumber(value);
  return score === null ? null : Math.max(0, Math.min(100, Math.round(score)));
}

function hiringSignal(value: unknown): HiringSignal | null {
  return (HIRING_SIGNALS as readonly unknown[]).includes(value) ? (value as HiringSignal) : null;
}

function dimension(value: unknown): ReportDimension {
  const raw = asRecord(value);
  const score = asNumber(raw.score);
  return {
    score: score === null ? null : Math.max(1, Math.min(5, Math.round(score))),
    evidence: asText(raw.evidence),
    recommendation: asText(raw.recommendation),
  };
}

function reportBase(input: unknown, mode: string) {
  const raw = asRecord(input);
  const score = overallScore(raw.overall_score);
  if (score === null) return null;
  return {
    report: {
      version: 'v1' as const,
      mode,
      overall_score: score,
      hiring_signal: hiringSignal(raw.hiring_signal),
      summary: asText(raw.summary),
      strengths: stringList(raw.strengths),
      weaknesses: stringList(raw.weaknesses),
      next_steps: prioritized(stringList(raw.next_steps)),
    },
    rubric: asRecord(raw.rubric),
  };
}

/** The live copilot's session report, or null when the input has no overall score. */
export function normalizeMockInterviewReport(input: unknown, mode: string): MockInterviewReport | null {
  const base = reportBase(input, mode);
  if (!base) return null;
  const rubric = Object.fromEntries(LIVE_RUBRIC_KEYS.map((key) => [key, dimension(base.rubric[key])]));
  return MockInterviewReportSchema.parse({ ...base.report, rubric });
}

/** A practice interview's report, or null when the input has no overall score. */
export function normalizePracticeReport(input: unknown, mode: string): PracticeReport | null {
  const base = reportBase(input, mode);
  if (!base) return null;
  const rubric: PracticeReport['rubric'] = {};
  for (const key of PRACTICE_RUBRIC_KEYS) {
    const area = dimension(base.rubric[key]);
    if (area.score !== null) rubric[key] = { ...area, score: area.score };
  }
  return PracticeReportSchema.parse({ ...base.report, rubric });
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
