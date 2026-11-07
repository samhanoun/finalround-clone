jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn(async () => true) }));
jest.mock('@/lib/notify', () => ({ userEmail: jest.fn(async () => 'sam@example.com'), notify: jest.fn(), loadNotificationPrefs: jest.fn() }));

import { funnelCsvRows, jobFunnel, weeklyActivity, weekStart } from '@/lib/analytics/jobSearch';
import { nextSendAt, runScheduledReports, zonedTime } from '@/lib/analyticsReports';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { sendEmail } = jest.requireMock('@/lib/email') as { sendEmail: jest.Mock };

describe('jobFunnel', () => {
  it('counts how far each job got', () => {
    const funnel = jobFunnel([
      { stage: 'saved', applied_at: null },
      { stage: 'applied', applied_at: '2026-10-01T00:00:00Z' },
      { stage: 'oa', applied_at: '2026-10-01T00:00:00Z' },
      { stage: 'interview', applied_at: '2026-10-01T00:00:00Z' },
      { stage: 'offer', applied_at: '2026-10-01T00:00:00Z' },
      { stage: 'rejected', applied_at: null },
    ]);
    expect(funnel.stages.map((stage) => [stage.key, stage.count, stage.fromPrevious])).toEqual([
      ['tracked', 6, null],
      ['applied', 5, 83.3],
      ['interviewing', 2, 40],
      ['offer', 1, 50],
    ]);
    expect(funnel.rejected).toBe(1);
    // Column and stage names come from the caller's translations.
    const columns = { stage: 'Etapa', jobs: 'Empleos', fromPrevious: '% de la etapa anterior' };
    expect(funnelCsvRows(funnel, columns, (key) => `es:${key}`)[1]).toEqual({ Etapa: 'es:applied', Empleos: 5, '% de la etapa anterior': 83.3 });
  });

  it('handles an empty board', () => {
    expect(jobFunnel([]).stages.every((stage) => stage.count === 0)).toBe(true);
  });
});

describe('weeklyActivity', () => {
  it('buckets activity into Monday-starting weeks', () => {
    const now = new Date('2026-10-28T12:00:00Z'); // a Wednesday
    expect(weekStart(now).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    const weeks = weeklyActivity(
      {
        practice: [{ created_at: '2026-10-27T09:00:00Z' }, { created_at: '2026-10-20T09:00:00Z' }],
        reports: [{ generated_at: '2026-10-27T10:00:00Z', overall_score: 70 }, { generated_at: '2026-10-28T10:00:00Z', overall_score: 80 }],
        live: [{ started_at: '2026-10-26T00:30:00Z', consumed_minutes: 12 }],
        applications: [{ applied_at: '2026-10-25T23:00:00Z' }],
      },
      now,
      3,
    );
    expect(weeks).toEqual([
      { week: '2026-10-12', practice: 0, averageScore: null, liveSessions: 0, liveMinutes: 0, applied: 0 },
      { week: '2026-10-19', practice: 1, averageScore: null, liveSessions: 0, liveMinutes: 0, applied: 1 },
      { week: '2026-10-26', practice: 1, averageScore: 75, liveSessions: 1, liveMinutes: 12, applied: 0 },
    ]);
  });
});

describe('report schedule times', () => {
  it('turns a wall-clock time in a zone into UTC', () => {
    expect(zonedTime(2026, 11, 2, 8, 'Europe/Paris').toISOString()).toBe('2026-11-02T07:00:00.000Z');
    expect(zonedTime(2026, 7, 6, 8, 'America/New_York').toISOString()).toBe('2026-07-06T12:00:00.000Z');
  });

  it('sends weekly reports on Monday at 08:00 and monthly ones on the 1st', () => {
    const wednesday = new Date('2026-10-28T12:00:00Z');
    expect(nextSendAt('weekly', wednesday, 'Europe/Paris').toISOString()).toBe('2026-11-02T07:00:00.000Z');
    expect(nextSendAt('monthly', wednesday, 'UTC').toISOString()).toBe('2026-11-01T08:00:00.000Z');
    // Monday before 08:00: today; after: next week.
    expect(nextSendAt('weekly', new Date('2026-11-02T06:00:00Z'), 'UTC').toISOString()).toBe('2026-11-02T08:00:00.000Z');
    expect(nextSendAt('weekly', new Date('2026-11-02T09:00:00Z'), 'UTC').toISOString()).toBe('2026-11-09T08:00:00.000Z');
  });
});

describe('runScheduledReports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SENDGRID_API_KEY = 'SG.test';
  });
  afterAll(() => {
    delete process.env.SENDGRID_API_KEY;
  });

  /** One due weekly summary; `claimed` says whether this run wins it. */
  function mockAdmin(claimed: boolean) {
    const updates: Array<Record<string, unknown>> = [];
    createAdminClient.mockReturnValue({
      from: (table: string) => {
        const rows: Record<string, unknown[]> = {
          analytics_report_schedules: [
            {
              id: 'r1',
              user_id: 'user-1',
              report_type: 'summary',
              frequency: 'weekly',
              enabled: true,
              last_sent_at: null,
              next_send_at: '2026-11-02T08:00:00Z',
              created_at: '2026-10-01T00:00:00Z',
            },
          ],
        };
        const builder: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'lte', 'gte', 'gt', 'in', 'order', 'limit']) builder[method] = () => builder;
        builder.maybeSingle = async () => ({ data: null });
        builder.update = (row: Record<string, unknown>) => {
          updates.push(row);
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.select = async () => ({ data: claimed ? [{ id: 'r1' }] : [] });
          chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
          return chain;
        };
        builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], count: 0 }).then(resolve);
        return builder;
      },
    });
    return updates;
  }

  it('claims a due report, emails it and moves it to next week', async () => {
    const updates = mockAdmin(true);
    expect(await runScheduledReports(new Date('2026-11-02T08:02:00Z'))).toBe(1);
    expect(updates[0]).toEqual({ next_send_at: '2026-11-09T08:00:00.000Z' });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'sam@example.com', subject: 'Apex Round: Weekly summary' }));
    expect(updates[1]).toEqual({ last_sent_at: '2026-11-02T08:02:00.000Z' });
  });

  it('skips a report another run already claimed', async () => {
    mockAdmin(false);
    expect(await runScheduledReports(new Date('2026-11-02T08:02:00Z'))).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
