import type { SupabaseClient } from '@supabase/supabase-js';
import { GOAL_ROUNDS, type GoalRound } from '@/lib/goalTypes';

/**
 * Everything Home shows, read with the user's own client (RLS scopes every
 * row to them), plus the pure helpers that turn the rows into what's on screen:
 * the next interview, the figures and the practice score trend.
 *
 * Months are UTC calendar months, the same periods the monthly quotas use
 * (check_quota: date_trunc('month', now())), so "this month" here agrees with
 * the usage block next to it.
 */

export type HomeGoal = {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  round: string | null;
  job_application_id: string | null;
  resume_document_id: string | null;
  job_description: string | null;
  archived: boolean | null;
  updated_at: string;
};

export type HomeJob = {
  id: string;
  company: string | null;
  title: string | null;
  stage: string;
  interview_at: string | null;
  applied_at: string | null;
  updated_at: string;
};

export type HomeSession = { id: string; title: string | null; status: string; created_at: string };
export type HomeResume = { id: string; filename: string | null; created_at: string };
export type HomeReport = { generated_at: string; overall_score: number | null };
export type HomeLive = { started_at: string; consumed_minutes: number | null };
export type HomeCopilot = { id: string; title: string | null; status: string; created_at: string };

/** The interview Home leads with: the soonest dated one, a job in the Interview stage, or the latest goal. */
export type NextUp = {
  source: 'scheduled' | 'stage' | 'goal';
  role: string | null;
  company: string | null;
  /** The goal's own name, for goals without a role and company. */
  name: string | null;
  /** ISO time of the interview, when the Jobs board has one. */
  at: string | null;
  round: GoalRound | null;
  /** The goal behind it: its résumé (name when known) and whether it has the job description. */
  goal: { id: string; hasResume: boolean; resumeName: string | null; hasJobDescription: boolean } | null;
  jobId: string | null;
};

/** First run: what's done of résumé → goal → live session. */
export type HomeSetup = { resumeName: string | null; liveSessions: number };

export type ScoreChange =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'change'; diff: number };

export type HomeStats = {
  practice: { total: number; thisMonth: number };
  score: { average: number | null; change: ScoreChange };
  applications: { total: number; thisMonth: number };
  /** Minutes this month, and the change against the same days of last month (null without a session last month). */
  liveMinutes: { thisMonth: number; change: number | null };
};

export type TrendPoint = { at: string; score: number };

export type HomeData = {
  next: NextUp | null;
  setup: HomeSetup;
  stats: HomeStats;
  trend: TrendPoint[];
  sessions: HomeSession[];
  resumes: HomeResume[];
  activity: { sessions: HomeSession[]; resumes: HomeResume[]; copilot: HomeCopilot[] };
};

/** How many scored interviews the trend shows: the latest dozen. */
export const TREND_POINTS = 12;
const LIST_ROWS = 5;

/** Midnight UTC on the 1st of this month (offset 0), last month (-1) and so on. */
export function utcMonthStart(now: Date, offset = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const newestFirst = <T extends { updated_at: string }>(a: T, b: T) => time(b.updated_at) - time(a.updated_at);
const mean = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

function isRound(value: string | null): value is GoalRound {
  return value !== null && (GOAL_ROUNDS as readonly string[]).includes(value);
}

/** The next interview to get ready for, or null when there's nothing to go on yet (first run). */
export function pickNextUp(goals: HomeGoal[], jobs: HomeJob[], resumes: HomeResume[], now: Date): NextUp | null {
  const active = goals.filter((goal) => !goal.archived);
  const goalFor = (job: HomeJob) => active.find((goal) => goal.job_application_id === job.id) ?? null;
  const resumeName = (id: string | null) => (id ? (resumes.find((item) => item.id === id)?.filename ?? null) : null);

  const build = (source: NextUp['source'], goal: HomeGoal | null, job: HomeJob | null): NextUp => ({
    source,
    role: goal?.role?.trim() || job?.title?.trim() || null,
    company: goal?.company?.trim() || job?.company?.trim() || null,
    name: goal?.name?.trim() || null,
    at: source === 'scheduled' ? (job?.interview_at ?? null) : null,
    round: goal && isRound(goal.round) ? goal.round : null,
    goal: goal
      ? {
          id: goal.id,
          hasResume: Boolean(goal.resume_document_id),
          resumeName: resumeName(goal.resume_document_id),
          hasJobDescription: Boolean(goal.job_description?.trim()),
        }
      : null,
    jobId: job?.id ?? null,
  });

  // A dated interview that's still ahead, on a job that's still open.
  const upcoming = jobs
    .filter((job) => job.stage !== 'offer' && job.stage !== 'rejected' && time(job.interview_at) > now.getTime())
    .sort((a, b) => time(a.interview_at) - time(b.interview_at));
  if (upcoming[0]) return build('scheduled', goalFor(upcoming[0]), upcoming[0]);

  const interviewing = jobs.filter((job) => job.stage === 'interview').sort(newestFirst);
  if (interviewing[0]) return build('stage', goalFor(interviewing[0]), interviewing[0]);

  const latest = [...active].sort(newestFirst)[0];
  if (latest) return build('goal', latest, jobs.find((job) => job.id === latest.job_application_id) ?? null);

  return null;
}

/**
 * The four figures, each with a change only where it can be stated honestly:
 * - practice interviews and applications sent: the total, and how many of them are from this month;
 * - average score: the average of every scored interview, against what it was at the end of last month;
 * - live minutes this month, against the same days of last month (Nov 1–7 vs Oct 1–7), and only when
 *   there was a live session last month to compare with.
 */
export function homeStats(
  input: { practiceTotal: number; practiceThisMonth: number; reports: HomeReport[]; jobs: HomeJob[]; live: HomeLive[] },
  now: Date,
): HomeStats {
  const monthStart = utcMonthStart(now).getTime();
  const lastMonthStart = utcMonthStart(now, -1).getTime();
  const nowMs = now.getTime();

  const scored = input.reports.filter((report) => typeof report.overall_score === 'number' && !Number.isNaN(time(report.generated_at)));
  const scores = scored.map((report) => report.overall_score as number);
  const before = scored.filter((report) => time(report.generated_at) < monthStart).map((report) => report.overall_score as number);
  const average = scores.length ? mean(scores) : null;
  let change: ScoreChange = { kind: 'none' };
  if (average !== null) change = before.length ? { kind: 'change', diff: average - mean(before) } : { kind: 'new' };

  const sent = input.jobs.filter((job) => job.stage !== 'saved');

  const minutes = (from: number, to: number) =>
    input.live
      .filter((row) => {
        const at = time(row.started_at);
        return at >= from && at < to;
      })
      .reduce((sum, row) => sum + (Number(row.consumed_minutes) || 0), 0);
  const thisMonth = minutes(monthStart, nowMs + 1);
  const sameDaysLastMonth = minutes(lastMonthStart, Math.min(lastMonthStart + (nowMs - monthStart), monthStart));
  const hadLastMonth = input.live.some((row) => time(row.started_at) >= lastMonthStart && time(row.started_at) < monthStart);

  return {
    practice: { total: input.practiceTotal, thisMonth: input.practiceThisMonth },
    score: { average, change },
    applications: { total: sent.length, thisMonth: sent.filter((job) => time(job.applied_at) >= monthStart).length },
    liveMinutes: { thisMonth, change: hadLastMonth ? thisMonth - sameDaysLastMonth : null },
  };
}

/** The latest scored practice interviews, oldest first. */
export function scoreTrend(reports: HomeReport[], points = TREND_POINTS): TrendPoint[] {
  return reports
    .filter((report) => typeof report.overall_score === 'number' && !Number.isNaN(time(report.generated_at)))
    .sort((a, b) => time(a.generated_at) - time(b.generated_at))
    .slice(-points)
    .map((report) => ({ at: report.generated_at, score: report.overall_score as number }));
}

/** Reads everything Home needs in one round of parallel queries. A query that fails reads as empty. */
export async function loadHome(supabase: SupabaseClient, userId: string, now: Date = new Date()): Promise<HomeData> {
  const monthStart = utcMonthStart(now).toISOString();
  const lastMonthStart = utcMonthStart(now, -1).toISOString();

  const [goals, jobs, sessions, practiceTotal, practiceThisMonth, reports, live, copilot, liveTotal, resumes] = await Promise.all([
    supabase
      .from('goals')
      .select('id, name, company, role, round, job_application_id, resume_document_id, job_description, archived, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('job_applications')
      .select('id, company, title, stage, interview_at, applied_at, updated_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1000),
    supabase
      .from('interview_sessions')
      .select('id, title, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LIST_ROWS),
    supabase.from('interview_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('interview_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', monthStart),
    supabase
      .from('interview_reports')
      .select('generated_at, overall_score')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
      .limit(500),
    supabase.from('copilot_sessions').select('started_at, consumed_minutes').eq('user_id', userId).gte('started_at', lastMonthStart).limit(1000),
    supabase
      .from('copilot_sessions')
      .select('id, title, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(3),
    supabase.from('copilot_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('resume_documents')
      .select('id, filename, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const rows = <T,>(result: { data: unknown }) => ((result.data ?? []) as T[]);
  const goalRows = rows<HomeGoal>(goals);
  const jobRows = rows<HomeJob>(jobs);
  const sessionRows = rows<HomeSession>(sessions);
  const reportRows = rows<HomeReport>(reports);
  const resumeRows = rows<HomeResume>(resumes);

  return {
    next: pickNextUp(goalRows, jobRows, resumeRows, now),
    setup: { resumeName: resumeRows[0] ? (resumeRows[0].filename ?? '') : null, liveSessions: liveTotal.count ?? 0 },
    stats: homeStats(
      {
        practiceTotal: practiceTotal.count ?? 0,
        practiceThisMonth: practiceThisMonth.count ?? 0,
        reports: reportRows,
        jobs: jobRows,
        live: rows<HomeLive>(live),
      },
      now,
    ),
    trend: scoreTrend(reportRows),
    sessions: sessionRows,
    resumes: resumeRows.slice(0, LIST_ROWS),
    activity: { sessions: sessionRows, resumes: resumeRows.slice(0, 3), copilot: rows<HomeCopilot>(copilot) },
  };
}
