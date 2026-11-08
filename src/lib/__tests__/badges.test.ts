jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/localizedEmail', () => ({ userLocaleAndZone: jest.fn(async () => ({ locale: 'en', timeZone: 'UTC' })) }));

import { activeDays, badgeId, BADGE_TYPES, streakReachedOn, syncBadges, syncBadgesQuietly, type BadgeType } from '@/lib/badges';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { userLocaleAndZone } = jest.requireMock('@/lib/localizedEmail') as { userLocaleAndZone: jest.Mock };

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * A Supabase stand-in for the service-role client: in-memory tables with the
 * filters the sync uses, counts, and upserts that skip an existing primary key
 * (as `on conflict (id) do nothing` does).
 */
function fakeAdmin(tables: Tables, { failing = [] as string[] } = {}) {
  const reads: string[] = [];
  const client = {
    from(table: string) {
      const tests: Array<(row: Row) => boolean> = [];
      let head = false;
      let order: { column: string; ascending: boolean } | null = null;
      let limit = Infinity;
      let upsert: { rows: Row[]; ignoreDuplicates: boolean } | null = null;
      const run = () => {
        if (failing.includes(table)) return { data: null, count: null, error: { message: `${table} is down` } };
        if (upsert) {
          tables[table] ??= [];
          const written: Row[] = [];
          for (const row of upsert.rows) {
            if (tables[table].some((existing) => existing.id === row.id)) {
              if (!upsert.ignoreDuplicates) return { data: null, count: null, error: { message: 'duplicate key value violates unique constraint "badges_pkey"' } };
              continue;
            }
            tables[table].push({ ...row });
            written.push({ ...row });
          }
          return { data: written, count: null, error: null };
        }
        reads.push(table);
        let rows = (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
        if (order) {
          const { column, ascending } = order;
          rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
        }
        rows = rows.slice(0, limit);
        return { data: head ? null : rows.map((row) => ({ ...row })), count: rows.length, error: null };
      };
      const builder: Record<string, unknown> = {
        select: (_columns?: string, options?: { head?: boolean }) => {
          head = Boolean(options?.head);
          return builder;
        },
        eq: (column: string, value: unknown) => (tests.push((row) => row[column] === value), builder),
        neq: (column: string, value: unknown) => (tests.push((row) => row[column] !== value), builder),
        in: (column: string, values: unknown[]) => (tests.push((row) => values.includes(row[column])), builder),
        not: (column: string, operator: string, value: unknown) => {
          if (operator === 'is' && value === null) tests.push((row) => row[column] !== null && row[column] !== undefined);
          return builder;
        },
        order: (column: string, options?: { ascending?: boolean }) => ((order = { column, ascending: options?.ascending ?? true }), builder),
        limit: (n: number) => ((limit = n), builder),
        upsert: (rows: Row[], options?: { ignoreDuplicates?: boolean }) => ((upsert = { rows, ignoreDuplicates: Boolean(options?.ignoreDuplicates) }), builder),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client: client as never, tables, reads };
}

const USER = 'user-1';
const OTHER = 'user-2';
const day = (date: string, time = '10:00:00') => `${date}T${time}Z`;
/** n consecutive days from `start` (YYYY-MM-DD), at 10:00 UTC. */
function days(start: string, n: number): string[] {
  const first = Date.parse(`${start}T10:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(first + i * 86_400_000).toISOString());
}

const held = (tables: Tables, userId = USER) =>
  (tables.badges ?? []).filter((badge) => badge.user_id === userId).map((badge) => badge.badge_type as BadgeType).sort();

beforeEach(() => {
  jest.clearAllMocks();
  userLocaleAndZone.mockResolvedValue({ locale: 'en', timeZone: 'UTC' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('syncBadges milestones', () => {
  it('awards nothing to a new account', async () => {
    const admin = fakeAdmin({});
    expect(await syncBadges(USER, admin.client)).toEqual([]);
    expect(held(admin.tables)).toEqual([]);
  });

  it('first interview: a finished practice interview with its report', async () => {
    const admin = fakeAdmin({
      interview_sessions: [
        { id: 's-draft', user_id: USER, status: 'in_progress', created_at: day('2026-10-01') },
        { id: 's-done', user_id: USER, status: 'completed', created_at: day('2026-10-02') },
      ],
      // A report on an unfinished session doesn't count; the finished one does.
      interview_reports: [
        { session_id: 's-draft', user_id: USER, generated_at: day('2026-10-01', '11:00:00') },
        { session_id: 's-done', user_id: USER, generated_at: day('2026-10-02', '11:00:00') },
      ],
    });
    expect(await syncBadges(USER, admin.client)).toEqual(['first_interview']);
    expect(admin.tables.badges[0]).toMatchObject({
      id: badgeId(USER, 'first_interview'),
      user_id: USER,
      badge_type: 'first_interview',
      title: 'First interview',
      description: 'Finished your first practice interview.',
      metadata: { session_id: 's-done' },
    });
  });

  it('first interview: not for a finished session without a report, nor a report on an unfinished one', async () => {
    const admin = fakeAdmin({
      interview_sessions: [
        { id: 's-done', user_id: USER, status: 'completed', created_at: day('2026-10-02') },
        { id: 's-open', user_id: USER, status: 'in_progress', created_at: day('2026-10-03') },
      ],
      interview_reports: [{ session_id: 's-open', user_id: USER, generated_at: day('2026-10-03') }],
    });
    await syncBadges(USER, admin.client);
    expect(held(admin.tables)).not.toContain('first_interview');
  });

  it('five and ten sessions: live sessions that ended, not ones still running', async () => {
    const live = (n: number, status: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `${status}-${i}`, user_id: USER, status, started_at: day(`2026-09-${String(i + 1).padStart(2, '0')}`) }));
    const admin = fakeAdmin({ copilot_sessions: [...live(3, 'stopped'), ...live(1, 'expired'), ...live(3, 'active')] });
    await syncBadges(USER, admin.client);
    expect(held(admin.tables)).toEqual([]);

    admin.tables.copilot_sessions.push(...live(1, 'stopped').map((row) => ({ ...row, id: 'fifth' })));
    expect(await syncBadges(USER, admin.client)).toEqual(['five_sessions']);
    expect(admin.tables.badges.find((b) => b.badge_type === 'five_sessions')?.metadata).toEqual({ live_sessions: 5 });

    admin.tables.copilot_sessions.push(...live(5, 'stopped').map((row, i) => ({ ...row, id: `more-${i}` })));
    expect(await syncBadges(USER, admin.client)).toEqual(['ten_sessions']);
  });

  it('job applied and first offer: from the Jobs board stages', async () => {
    const admin = fakeAdmin({ job_applications: [{ id: 'j1', user_id: USER, stage: 'saved' }] });
    await syncBadges(USER, admin.client);
    expect(held(admin.tables)).toEqual([]);

    admin.tables.job_applications.push({ id: 'j2', user_id: USER, stage: 'interview' });
    expect(await syncBadges(USER, admin.client)).toEqual(['job_applied']);
    expect(admin.tables.badges[0].metadata).toEqual({ job_application_id: 'j2' });

    admin.tables.job_applications.push({ id: 'j3', user_id: USER, stage: 'offer' });
    expect(await syncBadges(USER, admin.client)).toEqual(['first_offer']);
  });

  it('résumé tuned: a finished tailored résumé, or a résumé checked against a job', async () => {
    const tailored = fakeAdmin({
      resume_generations: [
        { id: 'g-failed', user_id: USER, status: 'failed' },
        { id: 'g-busy', user_id: USER, status: 'processing' },
      ],
      resume_documents: [{ id: 'd1', user_id: USER, ats_score: null }],
    });
    await syncBadges(USER, tailored.client);
    expect(held(tailored.tables)).toEqual([]);
    tailored.tables.resume_generations.push({ id: 'g-done', user_id: USER, status: 'completed' });
    expect(await syncBadges(USER, tailored.client)).toEqual(['resume_optimized']);
    expect(tailored.tables.badges[0].metadata).toEqual({ generation_id: 'g-done' });

    const checked = fakeAdmin({ resume_documents: [{ id: 'd2', user_id: USER, ats_score: 0 }] });
    expect(await syncBadges(USER, checked.client)).toEqual(['resume_optimized']);
    expect(checked.tables.badges[0].metadata).toEqual({ document_id: 'd2' });
  });

  it('referrals: a friend who signed up, then one who converted', async () => {
    const admin = fakeAdmin({
      referral_tracking: [
        { id: 'r-click', referrer_id: USER, status: 'pending' },
        { id: 'r-mine', referrer_id: OTHER, referee_id: USER, status: 'converted' },
      ],
    });
    // Clicks don't count, and being referred by someone else earns nothing.
    await syncBadges(USER, admin.client);
    expect(held(admin.tables)).toEqual([]);

    admin.tables.referral_tracking.push({ id: 'r-joined', referrer_id: USER, status: 'signed_up' });
    expect(await syncBadges(USER, admin.client)).toEqual(['referral_signup']);

    admin.tables.referral_tracking.push({ id: 'r-paid', referrer_id: USER, status: 'converted' });
    expect(await syncBadges(USER, admin.client)).toEqual(['referral_conversion']);
    expect(admin.tables.badges.find((b) => b.badge_type === 'referral_conversion')?.metadata).toEqual({ referral_id: 'r-paid' });
  });

  it('streaks: practice or live activity on 7, then 30, consecutive days', async () => {
    const practice = days('2026-10-01', 4).map((created_at, i) => ({ id: `p${i}`, user_id: USER, created_at }));
    const live = days('2026-10-05', 2).map((started_at, i) => ({ id: `l${i}`, user_id: USER, started_at, status: 'stopped' }));
    const admin = fakeAdmin({ interview_sessions: practice, copilot_sessions: live });
    // Six days in a row: not yet.
    await syncBadges(USER, admin.client);
    expect(held(admin.tables)).not.toContain('streak_week');

    admin.tables.copilot_sessions.push({ id: 'l-day7', user_id: USER, started_at: day('2026-10-07'), status: 'active' });
    expect(await syncBadges(USER, admin.client)).toContain('streak_week');
    expect(admin.tables.badges.find((b) => b.badge_type === 'streak_week')?.metadata).toEqual({ reached_on: '2026-10-07', time_zone: 'UTC' });
    expect(held(admin.tables)).not.toContain('streak_month');

    admin.tables.interview_sessions.push(...days('2026-10-08', 23).map((created_at, i) => ({ id: `q${i}`, user_id: USER, created_at })));
    expect(await syncBadges(USER, admin.client)).toContain('streak_month');
  });

  it('streaks: a gap starts the count again', async () => {
    const admin = fakeAdmin({
      interview_sessions: [...days('2026-10-01', 6), ...days('2026-10-08', 6)].map((created_at, i) => ({ id: `p${i}`, user_id: USER, created_at })),
    });
    await syncBadges(USER, admin.client);
    expect(held(admin.tables)).not.toContain('streak_week');
  });

  it('only looks at this person’s data', async () => {
    const admin = fakeAdmin({
      job_applications: [{ id: 'j1', user_id: OTHER, stage: 'offer' }],
      copilot_sessions: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, user_id: OTHER, status: 'stopped', started_at: day('2026-10-01') })),
      resume_generations: [{ id: 'g1', user_id: OTHER, status: 'completed' }],
    });
    expect(await syncBadges(USER, admin.client)).toEqual([]);
  });
});

describe('syncBadges idempotency', () => {
  const earnedEverything = (): Tables => ({
    interview_sessions: days('2026-09-01', 30).map((created_at, i) => ({ id: `s${i}`, user_id: USER, status: 'completed', created_at })),
    interview_reports: [{ session_id: 's0', user_id: USER, generated_at: day('2026-09-01', '11:00:00') }],
    copilot_sessions: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, user_id: USER, status: 'stopped', started_at: day('2026-09-01') })),
    job_applications: [{ id: 'j1', user_id: USER, stage: 'offer' }],
    resume_generations: [{ id: 'g1', user_id: USER, status: 'completed' }],
    referral_tracking: [{ id: 'r1', referrer_id: USER, status: 'converted' }],
  });

  it('awards every kind once, and nothing more on the next visit', async () => {
    const admin = fakeAdmin(earnedEverything());
    expect((await syncBadges(USER, admin.client)).sort()).toEqual([...BADGE_TYPES].sort());
    expect(await syncBadges(USER, admin.client)).toEqual([]);
    expect(held(admin.tables)).toEqual([...BADGE_TYPES].sort());
    expect(admin.tables.badges).toHaveLength(BADGE_TYPES.length);
  });

  it('skips the milestone checks once every badge is held', async () => {
    const admin = fakeAdmin(earnedEverything());
    await syncBadges(USER, admin.client);
    admin.reads.length = 0;
    await syncBadges(USER, admin.client);
    expect(admin.reads).toEqual(['badges']);
  });

  it('keeps a badge already held, even one stored with another id', async () => {
    const admin = fakeAdmin({
      ...earnedEverything(),
      badges: [{ id: 'legacy-id', user_id: USER, badge_type: 'job_applied', title: 'Applied' }],
    });
    const added = await syncBadges(USER, admin.client);
    expect(added).not.toContain('job_applied');
    expect(admin.tables.badges.filter((badge) => badge.badge_type === 'job_applied')).toHaveLength(1);
  });

  it('two syncs at once (two tabs) still give one badge of each kind', async () => {
    const admin = fakeAdmin(earnedEverything());
    const [first, second] = await Promise.all([syncBadges(USER, admin.client), syncBadges(USER, admin.client)]);
    expect([...first, ...second].sort()).toEqual([...BADGE_TYPES].sort());
    expect(admin.tables.badges).toHaveLength(BADGE_TYPES.length);
  });

  it('gives each person and kind its own stable id', () => {
    expect(badgeId(USER, 'first_offer')).toBe(badgeId(USER, 'first_offer'));
    expect(badgeId(USER, 'first_offer')).not.toBe(badgeId(OTHER, 'first_offer'));
    expect(badgeId(USER, 'first_offer')).not.toBe(badgeId(USER, 'job_applied'));
    expect(badgeId(USER, 'first_offer')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('syncBadges failures', () => {
  it('still awards the other badges when one milestone’s data can’t be read', async () => {
    const admin = fakeAdmin(
      {
        job_applications: [{ id: 'j1', user_id: USER, stage: 'applied' }],
        copilot_sessions: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, user_id: USER, status: 'stopped', started_at: day('2026-10-01') })),
      },
      { failing: ['resume_generations'] },
    );
    expect((await syncBadges(USER, admin.client)).sort()).toEqual(['five_sessions', 'job_applied']);
    expect(console.error).toHaveBeenCalledWith('[badges] could not check %s', 'resume_optimized', expect.stringContaining('resume_generations'));
  });

  it('throws when the held badges can’t be read, so nothing is awarded twice', async () => {
    const admin = fakeAdmin({ job_applications: [{ id: 'j1', user_id: USER, stage: 'applied' }] }, { failing: ['badges'] });
    await expect(syncBadges(USER, admin.client)).rejects.toThrow('badges');
  });
});

describe('syncBadgesQuietly (for the Home page)', () => {
  it('awards with the service role', async () => {
    const admin = fakeAdmin({ job_applications: [{ id: 'j1', user_id: USER, stage: 'applied' }] });
    createAdminClient.mockReturnValue(admin.client);
    expect(await syncBadgesQuietly(USER)).toEqual(['job_applied']);
  });

  it('never throws: no service role key, or a failing database', async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server admin operations');
    });
    await expect(syncBadgesQuietly(USER)).resolves.toEqual([]);

    createAdminClient.mockReturnValue(fakeAdmin({}, { failing: ['badges'] }).client);
    await expect(syncBadgesQuietly(USER)).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalledWith('[badges] sync failed', expect.any(String));
  });

  it('gives up waiting after the time limit', async () => {
    createAdminClient.mockReturnValue({ from: () => ({ select: () => ({ eq: () => new Promise(() => {}) }) }) });
    const started = Date.now();
    await expect(syncBadgesQuietly(USER, 50)).resolves.toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('streak helpers', () => {
  it('counts days in the person’s time zone', () => {
    // 23:30 UTC on Oct 1 is already Oct 2 in Berlin; 02:00 UTC on Oct 3 is still Oct 2 in New York.
    const times = ['2026-10-01T23:30:00Z', '2026-10-03T02:00:00Z'];
    expect(activeDays(times, 'UTC')).toEqual(['2026-10-01', '2026-10-03']);
    expect(activeDays(times, 'Europe/Berlin')).toEqual(['2026-10-02', '2026-10-03']);
    expect(activeDays(times, 'America/New_York')).toEqual(['2026-10-01', '2026-10-02']);
    // An unknown zone counts in UTC; bad times are skipped.
    expect(activeDays([...times, 'not a date', null], 'Mars/Olympus')).toEqual(['2026-10-01', '2026-10-03']);
  });

  it('finds the day a run of consecutive days was complete, across month ends', () => {
    expect(streakReachedOn(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'], 4)).toBe('2026-11-01');
    expect(streakReachedOn(['2026-10-29', '2026-10-30', '2026-11-01'], 3)).toBeNull();
    expect(streakReachedOn([], 1)).toBeNull();
  });

  it('uses the time zone from the person’s settings', async () => {
    userLocaleAndZone.mockResolvedValue({ locale: 'de', timeZone: 'Europe/Berlin' });
    // Seven evenings, 23:30 UTC: seven days in UTC, and in Berlin too (each is the next day there).
    const admin = fakeAdmin({
      interview_sessions: days('2026-10-01', 7).map((at, i) => ({ id: `p${i}`, user_id: USER, created_at: at.replace('10:00:00', '23:30:00') })),
    });
    await syncBadges(USER, admin.client);
    expect(admin.tables.badges.find((b) => b.badge_type === 'streak_week')?.metadata).toEqual({ reached_on: '2026-10-08', time_zone: 'Europe/Berlin' });
    expect(userLocaleAndZone).toHaveBeenCalledWith(USER);
  });
});
