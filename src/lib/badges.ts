import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { userLocaleAndZone } from '@/lib/localizedEmail';
import en from '@/messages/en.json';

/**
 * Achievements. Users can't write badges (migration 0029), so the server
 * awards them: syncBadges works each milestone out from the person's own data
 * with the service role and inserts the badges they've earned and don't have
 * yet. It runs on every Home visit (dashboard/page.tsx).
 *
 * It's idempotent. Badges already held are skipped, and each badge's id is
 * derived from the person and the kind (badgeId), so the primary key turns a
 * second insert of the same badge, say from two tabs at once, into a no-op.
 * Rows store the English title and description; the list shows each kind in
 * the reader's language (Badges.kinds.*).
 */

/** The kinds badges.badge_type allows (migration 0016). */
export const BADGE_TYPES = [
  'first_interview',
  'five_sessions',
  'ten_sessions',
  'first_offer',
  'streak_week',
  'streak_month',
  'resume_optimized',
  'job_applied',
  'referral_signup',
  'referral_conversion',
] as const;

export type BadgeType = (typeof BADGE_TYPES)[number];

/** What earned it, stored in badges.metadata. */
export type Evidence = Record<string, string | number>;

/** How many rows each milestone looks at, at most. Home runs this often, so a milestone is seen soon after it happens. */
const ROWS = 1000;
const DAY_MS = 86_400_000;

/**
 * The same id every time for this person and kind, shaped as an RFC 4122
 * version 5 UUID (badges.id is a uuid primary key).
 */
export function badgeId(userId: string, type: BadgeType): string {
  const hex = createHash('sha256').update(`apex-round-badge:${userId}:${type}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The calendar day (YYYY-MM-DD) of each time in `timeZone`, without repeats, in order. */
export function activeDays(times: Array<string | null | undefined>, timeZone: string): string[] {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const days = new Set<string>();
  for (const time of times) {
    const at = time ? Date.parse(time) : Number.NaN;
    if (Number.isNaN(at)) continue;
    const parts = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
    days.add(`${parts.year}-${parts.month}-${parts.day}`);
  }
  return [...days].sort();
}

/** The first day on which `length` consecutive days with activity were complete, or null. */
export function streakReachedOn(days: string[], length: number): string | null {
  let run = 0;
  let previous: number | null = null;
  for (const day of days) {
    const current = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;
    run = previous !== null && current - previous === 1 ? run + 1 : 1;
    previous = current;
    if (run >= length) return day;
  }
  return null;
}

type Context = {
  admin: SupabaseClient;
  userId: string;
};

/** Runs a query once per sync, however many milestones need it. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load());
}

function rowsOf<T>(result: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

/** The queries the milestones share, each read at most once per sync. */
function sources({ admin, userId }: Context) {
  return {
    /** Live sessions that ended (stopped, or expired after the app went away). */
    endedLiveSessions: once(async () => {
      const { count, error } = await admin
        .from('copilot_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('status', ['stopped', 'expired']);
      if (error) throw new Error(`copilot_sessions: ${error.message}`);
      return count ?? 0;
    }),
    /** Jobs that left "saved": applied, online assessment, interview, offer or rejected. */
    sentJobs: once(async () =>
      rowsOf<{ id: string; stage: string }>(
        await admin.from('job_applications').select('id, stage').eq('user_id', userId).neq('stage', 'saved').limit(ROWS),
        'job_applications',
      ),
    ),
    /** People who signed up with this person's referral link (converted ones signed up too). */
    referrals: once(async () =>
      rowsOf<{ id: string; status: string }>(
        await admin
          .from('referral_tracking')
          .select('id, status')
          .eq('referrer_id', userId)
          .in('status', ['signed_up', 'converted'])
          .limit(ROWS),
        'referral_tracking',
      ),
    ),
    /** The days with a practice interview or a live session, in the person's time zone. */
    activeDays: once(async () => {
      const [practice, live, { timeZone }] = await Promise.all([
        admin.from('interview_sessions').select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(ROWS),
        admin.from('copilot_sessions').select('started_at').eq('user_id', userId).order('started_at', { ascending: false }).limit(ROWS),
        userLocaleAndZone(userId),
      ]);
      const times = [
        ...rowsOf<{ created_at: string }>(practice, 'interview_sessions').map((row) => row.created_at),
        ...rowsOf<{ started_at: string }>(live, 'copilot_sessions').map((row) => row.started_at),
      ];
      return { days: activeDays(times, timeZone), timeZone };
    }),
  };
}

type Sources = ReturnType<typeof sources>;
type Check = (context: Context, shared: Sources) => Promise<Evidence | null>;

async function streak(shared: Sources, length: number): Promise<Evidence | null> {
  const { days, timeZone } = await shared.activeDays();
  const reachedOn = streakReachedOn(days, length);
  return reachedOn ? { reached_on: reachedOn, time_zone: timeZone } : null;
}

/** Each milestone: the evidence once it's met, otherwise null. */
const CHECKS: Record<BadgeType, Check> = {
  // The first practice interview that was finished and has its report.
  first_interview: async ({ admin, userId }) => {
    const [sessions, reports] = await Promise.all([
      admin
        .from('interview_sessions')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('created_at', { ascending: true })
        .limit(ROWS),
      admin
        .from('interview_reports')
        .select('session_id, generated_at')
        .eq('user_id', userId)
        .order('generated_at', { ascending: true })
        .limit(ROWS),
    ]);
    const completed = new Set(rowsOf<{ id: string }>(sessions, 'interview_sessions').map((row) => row.id));
    const report = rowsOf<{ session_id: string; generated_at: string }>(reports, 'interview_reports').find((row) =>
      completed.has(row.session_id),
    );
    return report ? { session_id: report.session_id } : null;
  },
  five_sessions: async (_context, shared) => {
    const count = await shared.endedLiveSessions();
    return count >= 5 ? { live_sessions: count } : null;
  },
  ten_sessions: async (_context, shared) => {
    const count = await shared.endedLiveSessions();
    return count >= 10 ? { live_sessions: count } : null;
  },
  first_offer: async (_context, shared) => {
    const offer = (await shared.sentJobs()).find((job) => job.stage === 'offer');
    return offer ? { job_application_id: offer.id } : null;
  },
  job_applied: async (_context, shared) => {
    const [job] = await shared.sentJobs();
    return job ? { job_application_id: job.id } : null;
  },
  // A tailored résumé that was written, or a résumé checked against a job (its match score is saved).
  resume_optimized: async ({ admin, userId }): Promise<Evidence | null> => {
    const [generations, checked] = await Promise.all([
      admin.from('resume_generations').select('id').eq('user_id', userId).eq('status', 'completed').limit(1),
      admin.from('resume_documents').select('id').eq('user_id', userId).not('ats_score', 'is', null).limit(1),
    ]);
    const [generation] = rowsOf<{ id: string }>(generations, 'resume_generations');
    if (generation) return { generation_id: generation.id };
    const [document] = rowsOf<{ id: string }>(checked, 'resume_documents');
    return document ? { document_id: document.id } : null;
  },
  referral_signup: async (_context, shared) => {
    const [referral] = await shared.referrals();
    return referral ? { referral_id: referral.id } : null;
  },
  referral_conversion: async (_context, shared) => {
    const referral = (await shared.referrals()).find((row) => row.status === 'converted');
    return referral ? { referral_id: referral.id } : null;
  },
  streak_week: async (_context, shared) => streak(shared, 7),
  streak_month: async (_context, shared) => streak(shared, 30),
};

/**
 * Awards the badges this person has earned and doesn't have yet. Returns the
 * kinds it added. Throws when the held badges can't be read or the insert
 * fails; a milestone whose data can't be read is skipped this time (logged).
 */
export async function syncBadges(userId: string, admin: SupabaseClient = createAdminClient()): Promise<BadgeType[]> {
  const { data: held, error } = await admin.from('badges').select('badge_type').eq('user_id', userId);
  if (error) throw new Error(`badges: ${error.message}`);
  const have = new Set(((held ?? []) as Array<{ badge_type: string }>).map((row) => row.badge_type));
  const missing = BADGE_TYPES.filter((type) => !have.has(type));
  if (!missing.length) return [];

  const context = { admin, userId };
  const shared = sources(context);
  const earned = await Promise.all(
    missing.map(async (type) => {
      try {
        return { type, evidence: await CHECKS[type](context, shared) };
      } catch (checkError) {
        console.error('[badges] could not check %s', type, checkError instanceof Error ? checkError.message : checkError);
        return { type, evidence: null };
      }
    }),
  );

  const awardedAt = new Date().toISOString();
  const rows = earned
    .filter((item): item is { type: BadgeType; evidence: Evidence } => item.evidence !== null)
    .map(({ type, evidence }) => ({
      id: badgeId(userId, type),
      // Set here rather than left to the column default, so every reader gets a real date.
      awarded_at: awardedAt,
      user_id: userId,
      badge_type: type,
      title: en.Badges.kinds[type].title,
      description: en.Badges.kinds[type].description,
      icon: type,
      metadata: evidence,
    }));
  if (!rows.length) return [];

  const { data: inserted, error: insertError } = await admin
    .from('badges')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    .select('badge_type');
  if (insertError) throw new Error(`badges insert: ${insertError.message}`);
  return ((inserted ?? []) as Array<{ badge_type: BadgeType }>).map((row) => row.badge_type);
}

/**
 * For page loads: syncBadges that never throws and never holds the page for
 * longer than `timeoutMs` (the sync carries on in the background if it's slow).
 */
export async function syncBadgesQuietly(userId: string, timeoutMs = 2_000): Promise<BadgeType[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = syncBadges(userId).catch((error: unknown) => {
    console.error('[badges] sync failed', error instanceof Error ? error.message : error);
    return [] as BadgeType[];
  });
  const timeout = new Promise<BadgeType[]>((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
