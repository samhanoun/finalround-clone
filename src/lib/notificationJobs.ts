import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { absoluteUrl, renderEmail } from '@/lib/emailTemplates';
import { loadNotificationPrefs, notify, userEmail } from '@/lib/notify';
import { emailKit, type Translate } from '@/lib/localizedEmail';

/**
 * Scheduled notifications, run every few minutes by /api/cron/notifications
 * (the custom server calls it; any external scheduler can too):
 * - interview reminders: a day and an hour before a job's interview date;
 * - follow-up reminders: on a job's follow-up date;
 * - the weekly digest email: Monday 08:00–09:00 in the user's time zone;
 * - scheduled analytics reports (src/lib/analyticsReports.ts).
 * Every notice has a dedupe key, so overlapping runs never send it twice.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type JobRow = {
  id: string;
  user_id: string;
  company: string | null;
  title: string | null;
  stage: string;
  interview_at: string | null;
  next_followup_at: string | null;
};

export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(0);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function formatWhen(iso: string, timeZone: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: safeTimeZone(timeZone),
  }).format(new Date(iso));
}

function jobName(job: Pick<JobRow, 'company' | 'title'>): string {
  return job.company?.trim() || job.title?.trim() || 'your interview';
}

/** Which reminder (if any) is due for an interview, by how far away it is. */
export function interviewReminderSlot(interviewAt: string, now: Date): '24h' | '1h' | null {
  const msUntil = new Date(interviewAt).getTime() - now.getTime();
  if (msUntil <= 0) return null;
  if (msUntil <= 1.25 * HOUR) return '1h';
  if (msUntil <= DAY) return '24h';
  return null;
}

async function timeZones(userIds: string[]): Promise<Map<string, string>> {
  const zones = new Map<string, string>();
  if (!userIds.length) return zones;
  const admin = createAdminClient();
  const [{ data: settings }, { data: profiles }] = await Promise.all([
    admin.from('user_settings').select('user_id, timezone').in('user_id', userIds),
    admin.from('profiles').select('id, timezone').in('id', userIds),
  ]);
  for (const row of profiles ?? []) if (row.timezone) zones.set(row.id as string, row.timezone as string);
  for (const row of settings ?? []) if (row.timezone) zones.set(row.user_id as string, row.timezone as string);
  return zones;
}

export async function runInterviewReminders(now = new Date()): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('job_applications')
    .select('id, user_id, company, title, stage, interview_at, next_followup_at')
    .eq('status', 'active')
    .gt('interview_at', now.toISOString())
    .lte('interview_at', new Date(now.getTime() + DAY).toISOString());
  const jobs = (data ?? []) as JobRow[];
  const zones = await timeZones([...new Set(jobs.map((job) => job.user_id))]);

  let sent = 0;
  for (const job of jobs) {
    const slot = job.interview_at ? interviewReminderSlot(job.interview_at, now) : null;
    if (!slot || !job.interview_at) continue;
    const when = formatWhen(job.interview_at, zones.get(job.user_id) ?? 'UTC');
    const minutes = Math.max(1, Math.round((new Date(job.interview_at).getTime() - now.getTime()) / 60_000));
    const result = await notify(job.user_id, {
      type: 'interview_reminder',
      title: slot === '1h' ? `Interview with ${jobName(job)} in ${minutes} min` : `Interview with ${jobName(job)}: ${when}`,
      message:
        slot === '1h'
          ? 'Open the live copilot, add the job description and test your audio before it starts.'
          : `${job.title ? `${job.title}. ` : ''}A short practice interview today helps; the live copilot is ready when you are.`,
      url: slot === '1h' ? '/copilot/live' : '/interview',
      data: { jobId: job.id, interviewAt: job.interview_at },
      dedupeKey: `interview:${job.id}:${job.interview_at}:${slot}`,
      i18n:
        slot === '1h'
          ? { key: 'interviewSoon', params: { name: jobName(job), minutes } }
          : { key: 'interviewTomorrow', params: { name: jobName(job), title: job.title ?? '' }, dates: { when: job.interview_at } },
    });
    if (!result.duplicate) sent += 1;
  }
  return sent;
}

export async function runFollowUpReminders(now = new Date()): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('job_applications')
    .select('id, user_id, company, title, stage, interview_at, next_followup_at')
    .eq('status', 'active')
    .lte('next_followup_at', now.toISOString())
    .gt('next_followup_at', new Date(now.getTime() - 3 * DAY).toISOString());
  let sent = 0;
  for (const job of (data ?? []) as JobRow[]) {
    if (!job.next_followup_at || job.stage === 'offer' || job.stage === 'rejected') continue;
    const result = await notify(job.user_id, {
      type: 'application_update',
      title: `Time to follow up with ${jobName(job)}`,
      message: `${job.title ? `${job.title}: ` : ''}send a short, friendly note, then set the next follow-up date on the Jobs board.`,
      url: '/jobs',
      data: { jobId: job.id },
      dedupeKey: `followup:${job.id}:${job.next_followup_at}`,
      i18n: { key: 'followUp', params: { name: jobName(job), title: job.title ?? '' } },
    });
    if (!result.duplicate) sent += 1;
  }
  return sent;
}

/** The Monday (YYYY-MM-DD) of the digest week, when it's Monday 08:00–08:59 for this time zone. */
export function digestWeek(now: Date, timeZone: string): string | null {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: safeTimeZone(timeZone),
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  if (parts.weekday !== 'Mon' || parts.hour !== '08') return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export type DigestData = {
  practiceCount: number;
  averageScore: number | null;
  liveSessions: number;
  liveMinutes: number;
  applied: number;
  interviewing: number;
  offers: number;
  upcoming: Array<{ name: string; when: string }>;
};

export async function digestData(userId: string, now: Date, timeZone: string, locale?: string): Promise<DigestData> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const nextWeek = new Date(now.getTime() + 7 * DAY).toISOString();
  const [practice, reports, live, jobs, upcoming] = await Promise.all([
    admin.from('interview_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since),
    admin.from('interview_reports').select('overall_score').eq('user_id', userId).gte('created_at', since),
    admin.from('copilot_sessions').select('duration_seconds').eq('user_id', userId).gte('started_at', since),
    admin.from('job_applications').select('stage, applied_at').eq('user_id', userId).eq('status', 'active'),
    admin
      .from('job_applications')
      .select('company, title, interview_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('interview_at', now.toISOString())
      .lte('interview_at', nextWeek)
      .order('interview_at', { ascending: true })
      .limit(5),
  ]);
  const scores = (reports.data ?? []).map((r) => r.overall_score).filter((s): s is number => typeof s === 'number');
  const jobRows = (jobs.data ?? []) as Array<{ stage: string; applied_at: string | null }>;
  return {
    practiceCount: practice.count ?? 0,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    liveSessions: (live.data ?? []).length,
    liveMinutes: Math.round((live.data ?? []).reduce((sum, row) => sum + (Number(row.duration_seconds) || 0), 0) / 60),
    applied: jobRows.filter((row) => row.applied_at && row.applied_at >= since).length,
    interviewing: jobRows.filter((row) => row.stage === 'interview').length,
    offers: jobRows.filter((row) => row.stage === 'offer').length,
    upcoming: ((upcoming.data ?? []) as Array<{ company: string | null; title: string | null; interview_at: string }>).map((row) => ({
      name: jobName(row),
      when: formatWhen(row.interview_at, timeZone, locale),
    })),
  };
}

export function hasDigestContent(data: DigestData): boolean {
  return data.practiceCount + data.liveSessions + data.applied + data.interviewing + data.offers + data.upcoming.length > 0;
}

/** The weekly digest in the user's language: `t` reads the Digest messages, `settingsLabel` is Email.changeSettings. */
export function digestEmail(data: DigestData, t: Translate, settingsLabel?: string) {
  const sections = [
    {
      heading: t('practice'),
      lines: [
        data.practiceCount
          ? data.averageScore !== null
            ? t('practiceAverage', { count: data.practiceCount, score: data.averageScore })
            : t('practiceLine', { count: data.practiceCount })
          : t('noPractice'),
      ],
    },
    {
      heading: t('live'),
      lines: [data.liveSessions ? t('liveLine', { sessions: data.liveSessions, minutes: data.liveMinutes }) : t('noLive')],
    },
    {
      heading: t('jobSearch'),
      lines: [t('jobsLine', { applied: data.applied, interviewing: data.interviewing, offers: data.offers })],
    },
    ...(data.upcoming.length
      ? [{ heading: t('comingUp'), lines: data.upcoming.map((item) => t('upcomingLine', { name: item.name, when: item.when })) }]
      : []),
  ];
  return renderEmail({
    title: t('title'),
    paragraphs: [t('intro')],
    sections,
    button: { label: t('open'), url: absoluteUrl('/dashboard') },
    footer: t('footer'),
    ...(settingsLabel ? { settingsLabel } : {}),
  });
}

export async function runWeeklyDigests(now = new Date()): Promise<number> {
  if (!process.env.SENDGRID_API_KEY) return 0;
  const admin = createAdminClient();
  const { data } = await admin.from('notification_preferences').select('user_id').eq('email_weekly_digest', true);
  const userIds = (data ?? []).map((row) => row.user_id as string);
  const zones = await timeZones(userIds);

  let sent = 0;
  for (const userId of userIds) {
    const timeZone = zones.get(userId) ?? 'UTC';
    const week = digestWeek(now, timeZone);
    if (!week) continue;
    const prefs = await loadNotificationPrefs(userId);
    if (!prefs.email_weekly_digest) continue;
    const kit = await emailKit(userId);
    const content = await digestData(userId, now, timeZone, kit.locale);
    if (!hasDigestContent(content)) continue;

    const { data: claimed } = await admin
      .from('notification_log')
      .upsert({ user_id: userId, dedupe_key: `digest:${week}` }, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
      .select('dedupe_key');
    if (!claimed?.length) continue;

    const to = await userEmail(userId);
    if (!to) continue;
    const t = kit.t('Digest');
    const email = digestEmail(content, t, kit.t('Email')('changeSettings'));
    if (await sendEmail({ to, subject: t('title'), text: email.text, html: email.html })) sent += 1;
  }
  return sent;
}

export async function runScheduledNotifications(now = new Date()) {
  // Imported here: analyticsReports builds on this module's digest helpers.
  const { runScheduledReports } = await import('@/lib/analyticsReports');
  const [interviews, followUps, digests, reports] = await Promise.all([
    runInterviewReminders(now),
    runFollowUpReminders(now),
    runWeeklyDigests(now),
    runScheduledReports(now),
  ]);
  return { interviews, followUps, digests, reports };
}
