import { hasAnyActivity, summarizeOverview, type OverviewRows } from '@/lib/analytics/overview';

// Local wall-clock times, so the tests hold in any time zone.
const NOW = new Date(2026, 9, 23, 15, 0);
const at = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute).toISOString();

const EMPTY: OverviewRows = { liveSessions: [], practiceInterviews: [], reports: [] };

describe('summarizeOverview', () => {
  it('buckets the last 7 days by local day, today included', () => {
    const rows: OverviewRows = {
      liveSessions: [
        { started_at: at(10, 23, 9), consumed_minutes: 12 },
        { started_at: at(10, 23, 23, 59), consumed_minutes: null },
        { started_at: at(10, 17, 0, 0), consumed_minutes: 5 },
        { started_at: at(10, 24, 0, 0), consumed_minutes: 30 }, // tomorrow: not counted
      ],
      practiceInterviews: [{ created_at: at(10, 20) }, { created_at: at(10, 20, 18) }],
      reports: [],
    };

    const summary = summarizeOverview(rows, 7, NOW);

    expect(summary.bucketDays).toBe(1);
    expect(summary.buckets.map((b) => b.start)).toEqual([
      '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
    ]);
    expect(summary.buckets[0]).toMatchObject({ liveSessions: 1, liveMinutes: 5, practiceInterviews: 0 });
    expect(summary.buckets[3]).toMatchObject({ liveSessions: 0, practiceInterviews: 2 });
    expect(summary.buckets[6]).toMatchObject({ liveSessions: 2, liveMinutes: 12 });
    expect(summary.current).toMatchObject({ liveSessions: 3, liveMinutes: 17, practiceInterviews: 2 });
  });

  it('compares against the same span just before, and ignores anything older', () => {
    const rows: OverviewRows = {
      liveSessions: [
        { started_at: at(10, 22), consumed_minutes: 10 },
        { started_at: at(10, 16, 23, 59), consumed_minutes: 4 }, // previous 7 days
        { started_at: at(10, 10, 0, 0), consumed_minutes: 6 }, // first moment of the previous span
        { started_at: at(10, 9, 23, 59), consumed_minutes: 99 }, // older than both
      ],
      practiceInterviews: [],
      reports: [],
    };

    const summary = summarizeOverview(rows, 7, NOW);

    expect(summary.current).toMatchObject({ liveSessions: 1, liveMinutes: 10 });
    expect(summary.previous).toMatchObject({ liveSessions: 2, liveMinutes: 10 });
  });

  it('averages only scored reports and lists them oldest first', () => {
    const rows: OverviewRows = {
      liveSessions: [],
      practiceInterviews: [],
      reports: [
        { generated_at: at(10, 21), overall_score: 80 },
        { generated_at: at(10, 19), overall_score: 71 },
        { generated_at: at(10, 20), overall_score: null },
        { generated_at: at(10, 12), overall_score: 50 },
      ],
    };

    const summary = summarizeOverview(rows, 7, NOW);

    expect(summary.current).toMatchObject({ averageScore: 76, scoredReports: 2 });
    expect(summary.previous).toMatchObject({ averageScore: 50, scoredReports: 1 });
    expect(summary.scores).toEqual([
      { at: at(10, 19), score: 71 },
      { at: at(10, 21), score: 80 },
    ]);
  });

  it('has no average score when nothing in the period is scored', () => {
    expect(summarizeOverview(EMPTY, 30, NOW).current).toEqual({
      liveSessions: 0,
      liveMinutes: 0,
      practiceInterviews: 0,
      averageScore: null,
      scoredReports: 0,
    });
  });

  it('uses weekly buckets for 90 days, the last one shorter, adding up to the totals', () => {
    const rows: OverviewRows = {
      liveSessions: [
        { started_at: at(7, 26, 0, 0), consumed_minutes: 3 }, // first day of the 90
        { started_at: at(10, 18), consumed_minutes: 7 },
        { started_at: at(10, 23), consumed_minutes: 2 },
      ],
      practiceInterviews: [{ created_at: at(8, 30) }],
      reports: [],
    };

    const summary = summarizeOverview(rows, 90, NOW);

    expect(summary.bucketDays).toBe(7);
    expect(summary.buckets).toHaveLength(13);
    expect(summary.buckets[0].start).toBe('2026-07-26');
    expect(summary.buckets[12].start).toBe('2026-10-18');
    expect(summary.buckets[12]).toMatchObject({ liveSessions: 2, liveMinutes: 9 });
    const total = summary.buckets.reduce((sum, b) => sum + b.liveSessions, 0);
    expect(total).toBe(summary.current.liveSessions);
    expect(summary.current).toMatchObject({ liveSessions: 3, practiceInterviews: 1 });
  });
});

describe('hasAnyActivity', () => {
  it('is false only when every list is empty', () => {
    expect(hasAnyActivity(EMPTY)).toBe(false);
    expect(hasAnyActivity({ ...EMPTY, reports: [{ generated_at: at(10, 1), overall_score: null }] })).toBe(true);
  });
});
