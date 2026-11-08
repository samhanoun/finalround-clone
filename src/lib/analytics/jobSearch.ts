/**
 * The signed-in user's own analytics beyond the overview:
 * - the job-search funnel, from the Jobs board (tracked → applied →
 *   interviewing → offer);
 * - weekly activity: practice, scores, live sessions and applications per week.
 * Pure functions over rows read with the user's client (RLS scopes them).
 */

export type JobRow = { stage: string; applied_at: string | null };

export type FunnelStage = {
  /** Shown through the Funnel.stages messages, so it reads in the user's language. */
  key: 'tracked' | 'applied' | 'interviewing' | 'offer';
  count: number;
  /** Share of the previous stage that reached this one, in %, or null for the first stage. */
  fromPrevious: number | null;
};

export type JobFunnel = { stages: FunnelStage[]; total: number; rejected: number };

const APPLIED_STAGES = new Set(['applied', 'oa', 'interview', 'offer', 'rejected']);
const INTERVIEW_STAGES = new Set(['interview', 'offer']);

export function jobFunnel(rows: JobRow[]): JobFunnel {
  const counts = {
    tracked: rows.length,
    // A rejection means the application was sent, so it counts as applied.
    applied: rows.filter((row) => APPLIED_STAGES.has(row.stage) || row.applied_at).length,
    interviewing: rows.filter((row) => INTERVIEW_STAGES.has(row.stage)).length,
    offer: rows.filter((row) => row.stage === 'offer').length,
  };
  const order: Array<FunnelStage['key']> = ['tracked', 'applied', 'interviewing', 'offer'];
  const stages = order.map((key, index) => {
    const previous = index === 0 ? null : counts[order[index - 1]];
    return {
      key,
      count: counts[key],
      fromPrevious: previous === null ? null : previous === 0 ? 0 : Math.round((counts[key] / previous) * 1000) / 10,
    };
  });
  return { stages, total: rows.length, rejected: rows.filter((row) => row.stage === 'rejected').length };
}

export type WeekActivity = {
  /** Monday of the week (UTC), YYYY-MM-DD. */
  week: string;
  practice: number;
  averageScore: number | null;
  liveSessions: number;
  liveMinutes: number;
  applied: number;
};

export type ActivityRows = {
  practice: Array<{ created_at: string }>;
  reports: Array<{ generated_at: string | null; overall_score: number | null }>;
  live: Array<{ started_at: string; consumed_minutes: number | null }>;
  applications: Array<{ applied_at: string | null }>;
};

export const WEEKS_SHOWN = 8;

/** Monday 00:00 UTC of the week containing `date`. */
export function weekStart(date: Date): Date {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (start.getUTCDay() + 6) % 7; // Monday = 0
  start.setUTCDate(start.getUTCDate() - day);
  return start;
}

export function weeklyActivity(rows: ActivityRows, now: Date = new Date(), weeks = WEEKS_SHOWN): WeekActivity[] {
  const current = weekStart(now);
  const buckets: WeekActivity[] = [];
  const index = new Map<string, WeekActivity & { scores: number[] }>();
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(current);
    start.setUTCDate(start.getUTCDate() - i * 7);
    const key = start.toISOString().slice(0, 10);
    const bucket = { week: key, practice: 0, averageScore: null, liveSessions: 0, liveMinutes: 0, applied: 0, scores: [] as number[] };
    index.set(key, bucket);
    buckets.push(bucket);
  }
  const at = (iso: string | null | undefined) => (iso ? index.get(weekStart(new Date(iso)).toISOString().slice(0, 10)) : undefined);

  for (const row of rows.practice) {
    const bucket = at(row.created_at);
    if (bucket) bucket.practice += 1;
  }
  for (const row of rows.reports) {
    const bucket = at(row.generated_at);
    if (bucket && typeof row.overall_score === 'number') bucket.scores.push(row.overall_score);
  }
  for (const row of rows.live) {
    const bucket = at(row.started_at);
    if (bucket) {
      bucket.liveSessions += 1;
      bucket.liveMinutes += Number(row.consumed_minutes) || 0;
    }
  }
  for (const row of rows.applications) {
    const bucket = at(row.applied_at);
    if (bucket) bucket.applied += 1;
  }

  return buckets.map((bucket) => {
    const { scores, ...rest } = bucket as WeekActivity & { scores: number[] };
    return { ...rest, averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null };
  });
}

/** Rows for a CSV download, with column names (and stage names) in the user's language. */
export function funnelCsvRows(
  funnel: JobFunnel,
  columns: { stage: string; jobs: string; fromPrevious: string },
  stageName: (key: FunnelStage['key']) => string,
) {
  return funnel.stages.map((stage) => ({
    [columns.stage]: stageName(stage.key),
    [columns.jobs]: stage.count,
    [columns.fromPrevious]: stage.fromPrevious ?? '',
  }));
}

export function weeklyCsvRows(
  weeks: WeekActivity[],
  columns: { week: string; practice: string; averageScore: string; liveSessions: string; liveMinutes: string; applied: string },
) {
  return weeks.map((week) => ({
    [columns.week]: week.week,
    [columns.practice]: week.practice,
    [columns.averageScore]: week.averageScore ?? '',
    [columns.liveSessions]: week.liveSessions,
    [columns.liveMinutes]: week.liveMinutes,
    [columns.applied]: week.applied,
  }));
}
