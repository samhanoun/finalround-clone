/**
 * The signed-in user's own activity for the Analytics overview: live copilot
 * sessions, practice interviews and their scored reports.
 *
 * /api/analytics/overview returns the raw rows (RLS-scoped to the user) and
 * the browser buckets them here, so day boundaries follow the viewer's clock.
 */

export const OVERVIEW_RANGES = [7, 30, 90] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

// The 90-day view compares against the 90 days before it, so the route reads
// twice the longest range, plus a day so a viewer's local midnight is covered.
export const OVERVIEW_LOOKBACK_DAYS = 2 * OVERVIEW_RANGES[OVERVIEW_RANGES.length - 1] + 1;

// PostgREST caps a response at 1,000 rows by default; the route reports when
// a list hits it instead of silently undercounting.
export const OVERVIEW_ROW_LIMIT = 1000;

export interface LiveSessionRow {
  started_at: string;
  consumed_minutes: number | null;
}

export interface PracticeInterviewRow {
  created_at: string;
}

export interface ReportRow {
  generated_at: string;
  overall_score: number | null;
}

export interface OverviewRows {
  liveSessions: LiveSessionRow[];
  practiceInterviews: PracticeInterviewRow[];
  reports: ReportRow[];
}

export interface OverviewResponse extends OverviewRows {
  since: string;
  truncated: boolean;
}

export interface PeriodTotals {
  liveSessions: number;
  liveMinutes: number;
  practiceInterviews: number;
  /** Mean overall score of the reports in the period, or null with none scored. */
  averageScore: number | null;
  scoredReports: number;
}

export interface ActivityBucket {
  /** Local date the bucket starts on, YYYY-MM-DD. */
  start: string;
  liveSessions: number;
  liveMinutes: number;
  practiceInterviews: number;
}

export interface ScorePoint {
  at: string;
  score: number;
}

export interface OverviewSummary {
  days: OverviewRange;
  /** Daily buckets, or weekly ones (the last possibly shorter) for 90 days. */
  bucketDays: 1 | 7;
  current: PeriodTotals;
  previous: PeriodTotals;
  buckets: ActivityBucket[];
  /** Scored reports in the period, oldest first. */
  scores: ScorePoint[];
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function within(at: string, from: Date, to: Date): boolean {
  const t = Date.parse(at);
  return t >= from.getTime() && t < to.getTime();
}

function totalsFor(rows: OverviewRows, from: Date, to: Date): PeriodTotals {
  const live = rows.liveSessions.filter((s) => within(s.started_at, from, to));
  const scores = rows.reports
    .filter((r) => r.overall_score !== null && within(r.generated_at, from, to))
    .map((r) => r.overall_score as number);
  return {
    liveSessions: live.length,
    liveMinutes: live.reduce((sum, s) => sum + (s.consumed_minutes ?? 0), 0),
    practiceInterviews: rows.practiceInterviews.filter((p) => within(p.created_at, from, to)).length,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    scoredReports: scores.length,
  };
}

/** Totals for the last `days` days (today included) and the same span before it. */
export function summarizeOverview(rows: OverviewRows, days: OverviewRange, now: Date = new Date()): OverviewSummary {
  const end = addLocalDays(startOfLocalDay(now), 1);
  const start = addLocalDays(end, -days);
  const previousStart = addLocalDays(start, -days);
  const bucketDays = days > 30 ? 7 : 1;

  const buckets: ActivityBucket[] = [];
  for (let offset = 0; offset < days; offset += bucketDays) {
    const from = addLocalDays(start, offset);
    const to = addLocalDays(start, Math.min(offset + bucketDays, days));
    const live = rows.liveSessions.filter((s) => within(s.started_at, from, to));
    buckets.push({
      start: localDateKey(from),
      liveSessions: live.length,
      liveMinutes: live.reduce((sum, s) => sum + (s.consumed_minutes ?? 0), 0),
      practiceInterviews: rows.practiceInterviews.filter((p) => within(p.created_at, from, to)).length,
    });
  }

  const scores = rows.reports
    .filter((r) => r.overall_score !== null && within(r.generated_at, start, end))
    .sort((a, b) => Date.parse(a.generated_at) - Date.parse(b.generated_at))
    .map((r) => ({ at: r.generated_at, score: r.overall_score as number }));

  return {
    days,
    bucketDays,
    current: totalsFor(rows, start, end),
    previous: totalsFor(rows, previousStart, start),
    buckets,
    scores,
  };
}

/** True when the user has any live session, practice interview or report in the rows. */
export function hasAnyActivity(rows: OverviewRows): boolean {
  return rows.liveSessions.length > 0 || rows.practiceInterviews.length > 0 || rows.reports.length > 0;
}
