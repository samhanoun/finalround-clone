import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { absoluteUrl, renderEmail } from '@/lib/emailTemplates';
import { userEmail } from '@/lib/notify';
import { digestData, safeTimeZone } from '@/lib/notificationJobs';
import { jobFunnel, weeklyActivity, weekStart, type ActivityRows, type JobRow } from '@/lib/analytics/jobSearch';
import { type ReportFrequency, type ReportType } from '@/lib/analyticsReportTypes';
import { emailKit } from '@/lib/localizedEmail';

/**
 * Analytics → Reports: scheduled email reports, sent to the account's own
 * address (never to an address typed in, so it can't be used to spam).
 * Due reports go out from /api/cron/notifications; "Send now" uses sendReport.
 */

export type ReportSchedule = {
  id: string;
  user_id: string;
  report_type: ReportType;
  frequency: ReportFrequency;
  enabled: boolean;
  last_sent_at: string | null;
  next_send_at: string;
  created_at: string;
};

export const MAX_SCHEDULES = 5;

/** Minutes the zone is ahead of UTC at that moment. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The UTC instant of a wall-clock time in a time zone. */
export function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  // Once more, in case the guess and the answer sit on different sides of a DST change.
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * 60_000);
}

function localDate(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: parts.weekday as string };
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The next send time after `after`: Monday 08:00 (weekly) or the 1st at 08:00 (monthly), in the user's zone. */
export function nextSendAt(frequency: ReportFrequency, after: Date, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  const today = localDate(after, zone);
  if (frequency === 'weekly') {
    const daysUntilMonday = (7 - WEEKDAYS.indexOf(today.weekday)) % 7;
    for (const add of [daysUntilMonday, daysUntilMonday + 7]) {
      const date = new Date(Date.UTC(today.year, today.month - 1, today.day + add));
      const candidate = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 8, zone);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
  }
  // Monthly: the 1st of this month if it's still ahead, else the 1st of the next.
  for (const add of [0, 1, 2]) {
    const date = new Date(Date.UTC(today.year, today.month - 1 + add, 1));
    const candidate = zonedTime(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 8, zone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return new Date(after.getTime() + 30 * 86_400_000);
}

export async function userTimeZone(userId: string): Promise<string> {
  const admin = createAdminClient();
  const [{ data: settings }, { data: profile }] = await Promise.all([
    admin.from('user_settings').select('timezone').eq('user_id', userId).maybeSingle(),
    admin.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
  ]);
  return safeTimeZone((settings?.timezone as string | undefined) ?? (profile?.timezone as string | undefined));
}

async function jobRows(userId: string): Promise<JobRow[]> {
  const { data } = await createAdminClient()
    .from('job_applications')
    .select('stage, applied_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(5000);
  return (data ?? []) as JobRow[];
}

async function activityRows(userId: string, since: Date): Promise<ActivityRows> {
  const admin = createAdminClient();
  const from = since.toISOString();
  const [practice, reports, live, applications] = await Promise.all([
    admin.from('interview_sessions').select('created_at').eq('user_id', userId).gte('created_at', from).limit(5000),
    admin.from('interview_reports').select('generated_at, overall_score').eq('user_id', userId).gte('generated_at', from).limit(5000),
    admin.from('copilot_sessions').select('started_at, consumed_minutes').eq('user_id', userId).gte('started_at', from).limit(5000),
    admin.from('job_applications').select('applied_at').eq('user_id', userId).gte('applied_at', from).limit(5000),
  ]);
  return {
    practice: (practice.data ?? []) as ActivityRows['practice'],
    reports: (reports.data ?? []) as ActivityRows['reports'],
    live: (live.data ?? []) as ActivityRows['live'],
    applications: (applications.data ?? []) as ActivityRows['applications'],
  };
}

type Section = { heading: string; lines: string[] };
type Kit = Awaited<ReturnType<typeof emailKit>>;

/** The report's sections in the user's language (ReportEmail messages; stage names from Funnel). */
export async function reportSections(
  userId: string,
  type: ReportType,
  frequency: ReportFrequency,
  now: Date,
  kit: Pick<Kit, 't' | 'format' | 'locale'>,
): Promise<Section[]> {
  const timeZone = await userTimeZone(userId);
  const t = kit.t('ReportEmail');
  const tFunnel = kit.t('Funnel');
  const sections: Section[] = [];

  if (type === 'summary' || type === 'full') {
    const week = await digestData(userId, now, timeZone, kit.locale);
    sections.push({
      heading: t('lastWeek'),
      lines: [
        week.averageScore !== null
          ? t('practiceAverage', { count: week.practiceCount, score: week.averageScore })
          : t('practiceLine', { count: week.practiceCount }),
        t('liveLine', { sessions: week.liveSessions, minutes: week.liveMinutes }),
        t('appliedLine', { count: week.applied }),
        ...week.upcoming.map((item) => t('comingUp', { name: item.name, when: item.when })),
      ],
    });
  }

  if (type === 'job_search' || type === 'full') {
    const funnel = jobFunnel(await jobRows(userId));
    sections.push({
      heading: t('jobSearch'),
      lines: funnel.total
        ? [
            ...funnel.stages.map((stage) => {
              const values = { stage: tFunnel(`stages.${stage.key}`), count: stage.count };
              return stage.fromPrevious === null ? t('stageLine', values) : t('stageLineFrom', { ...values, percent: stage.fromPrevious });
            }),
            t('rejected', { count: funnel.rejected }),
          ]
        : [t('noJobs')],
    });
  }

  if (type === 'practice' || type === 'full') {
    const weeks = frequency === 'monthly' ? 5 : 4;
    const since = weekStart(now);
    since.setUTCDate(since.getUTCDate() - (weeks - 1) * 7);
    const activity = weeklyActivity(await activityRows(userId, since), now, weeks);
    sections.push({
      heading: t('byWeek'),
      lines: activity.map((week) => {
        const values = {
          week: kit.format.dateTime(new Date(`${week.week}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' }),
          practice: week.practice,
          live: week.liveSessions,
          minutes: week.liveMinutes,
          applied: week.applied,
        };
        return week.averageScore !== null ? t('weekLineScore', { ...values, score: week.averageScore }) : t('weekLine', values);
      }),
    });
  }
  return sections;
}

/** Builds and emails one report to the account's address, in its language. False when email isn't set up or there is no address. */
export async function sendReport(schedule: Pick<ReportSchedule, 'user_id' | 'report_type' | 'frequency'>, now = new Date()) {
  if (!process.env.SENDGRID_API_KEY) return false;
  const to = await userEmail(schedule.user_id);
  if (!to) return false;
  const kit = await emailKit(schedule.user_id);
  const t = kit.t('ReportEmail');
  const title = kit.t('Reports')(`types.${schedule.report_type}.label`);
  const email = renderEmail({
    title,
    paragraphs: [t('intro', { frequency: schedule.frequency })],
    sections: await reportSections(schedule.user_id, schedule.report_type, schedule.frequency, now, kit),
    button: { label: t('open'), url: absoluteUrl('/analytics') },
    footer: t('footer'),
    settingsLabel: kit.t('Email')('changeSettings'),
  });
  return sendEmail({ to, subject: t('subject', { title }), text: email.text, html: email.html });
}

/** Sends every due report once, even with overlapping runs (each is claimed by moving its next send time first). */
export async function runScheduledReports(now = new Date()): Promise<number> {
  if (!process.env.SENDGRID_API_KEY) return 0;
  const admin = createAdminClient();
  const { data } = await admin
    .from('analytics_report_schedules')
    .select('id, user_id, report_type, frequency, enabled, last_sent_at, next_send_at, created_at')
    .eq('enabled', true)
    .lte('next_send_at', now.toISOString())
    .limit(200);

  let sent = 0;
  for (const schedule of (data ?? []) as ReportSchedule[]) {
    const next = nextSendAt(schedule.frequency, now, await userTimeZone(schedule.user_id));
    const { data: claimed } = await admin
      .from('analytics_report_schedules')
      .update({ next_send_at: next.toISOString() })
      .eq('id', schedule.id)
      .eq('next_send_at', schedule.next_send_at)
      .select('id');
    if (!claimed?.length) continue;
    if (await sendReport(schedule, now)) {
      sent += 1;
      await admin.from('analytics_report_schedules').update({ last_sent_at: now.toISOString() }).eq('id', schedule.id);
    }
  }
  return sent;
}
