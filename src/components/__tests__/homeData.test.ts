import { homeStats, pickNextUp, scoreTrend, utcMonthStart, type HomeGoal, type HomeJob } from '@/app/[locale]/dashboard/homeData';

const NOW = new Date('2026-11-07T10:00:00Z');

const job = (over: Partial<HomeJob>): HomeJob => ({
  id: 'j1',
  company: 'Acme',
  title: 'Staff Engineer',
  stage: 'applied',
  interview_at: null,
  applied_at: null,
  updated_at: '2026-11-01T00:00:00Z',
  ...over,
});

const goal = (over: Partial<HomeGoal>): HomeGoal => ({
  id: 'g1',
  name: 'Staff engineer at Acme',
  company: 'Acme',
  role: 'Staff Engineer',
  round: 'system_design',
  job_application_id: null,
  resume_document_id: null,
  job_description: null,
  archived: false,
  updated_at: '2026-11-01T00:00:00Z',
  ...over,
});

const resumes = [{ id: 'r1', filename: 'cv.pdf', created_at: '2026-10-01T00:00:00Z' }];

describe('utcMonthStart', () => {
  it('is midnight UTC on the 1st, and steps back across a year', () => {
    expect(utcMonthStart(NOW).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(utcMonthStart(new Date('2026-01-15T00:00:00Z'), -1).toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });
});

describe('pickNextUp', () => {
  it('leads with the soonest dated interview still ahead, with the goal made for that job', () => {
    const jobs = [
      job({ id: 'later', company: 'Globex', interview_at: '2026-11-20T14:00:00Z' }),
      job({ id: 'soon', stage: 'interview', interview_at: '2026-11-12T14:00:00Z' }),
    ];
    const goals = [goal({ job_application_id: 'soon', resume_document_id: 'r1', job_description: 'Own payments reliability.' })];
    const next = pickNextUp(goals, jobs, resumes, NOW);
    expect(next).toMatchObject({
      source: 'scheduled',
      role: 'Staff Engineer',
      company: 'Acme',
      at: '2026-11-12T14:00:00Z',
      round: 'system_design',
      jobId: 'soon',
      goal: { id: 'g1', hasResume: true, resumeName: 'cv.pdf', hasJobDescription: true },
    });
  });

  it('skips dates that have passed and jobs already offered or rejected', () => {
    const jobs = [
      job({ id: 'past', interview_at: '2026-11-01T14:00:00Z' }),
      job({ id: 'offer', stage: 'offer', interview_at: '2026-11-12T14:00:00Z' }),
      job({ id: 'rejected', stage: 'rejected', interview_at: '2026-11-13T14:00:00Z' }),
    ];
    expect(pickNextUp([], jobs, resumes, NOW)).toBeNull();
  });

  it('falls back to a job in the Interview stage, which may have no goal yet', () => {
    const jobs = [job({ id: 'old', stage: 'interview', updated_at: '2026-10-01T00:00:00Z' }), job({ id: 'new', stage: 'interview', company: 'Globex', title: 'Platform Engineer' })];
    const next = pickNextUp([], jobs, resumes, NOW);
    expect(next).toMatchObject({ source: 'stage', jobId: 'new', company: 'Globex', role: 'Platform Engineer', at: null, goal: null });
  });

  it('then the latest active goal, and knows a résumé it can’t name', () => {
    const goals = [
      goal({ id: 'archived', archived: true, updated_at: '2026-11-06T00:00:00Z' }),
      goal({ id: 'older', updated_at: '2026-10-01T00:00:00Z' }),
      goal({ id: 'latest', name: 'Final round', role: null, company: null, round: 'final', resume_document_id: 'gone' }),
    ];
    const next = pickNextUp(goals, [], resumes, NOW);
    expect(next).toMatchObject({ source: 'goal', name: 'Final round', round: 'final', goal: { id: 'latest', hasResume: true, resumeName: null } });
  });

  it('is null on a first run, where archived goals don’t count', () => {
    expect(pickNextUp([goal({ archived: true })], [job({ stage: 'saved' })], resumes, NOW)).toBeNull();
  });
});

describe('homeStats', () => {
  const base = { practiceTotal: 12, practiceThisMonth: 3, reports: [], jobs: [], live: [] };

  it('counts applications past Saved, and those sent since the 1st (UTC)', () => {
    const jobs = [
      job({ stage: 'saved' }),
      job({ stage: 'applied', applied_at: '2026-11-03T09:00:00Z' }),
      job({ stage: 'interview', applied_at: '2026-10-20T09:00:00Z' }),
      job({ stage: 'rejected', applied_at: '2026-10-31T23:30:00Z' }),
    ];
    const stats = homeStats({ ...base, jobs }, NOW);
    expect(stats.practice).toEqual({ total: 12, thisMonth: 3 });
    expect(stats.applications).toEqual({ total: 3, thisMonth: 1 });
  });

  it('compares the average score with where it stood at the end of last month', () => {
    const reports = [
      { generated_at: '2026-10-06T10:00:00Z', overall_score: 60 },
      { generated_at: '2026-10-20T10:00:00Z', overall_score: 70 },
      { generated_at: '2026-11-03T10:00:00Z', overall_score: 80 },
      { generated_at: '2026-11-04T10:00:00Z', overall_score: null },
    ];
    expect(homeStats({ ...base, reports }, NOW).score).toEqual({ average: 70, change: { kind: 'change', diff: 5 } });
    // Nothing scored this month: the average hasn't moved.
    expect(homeStats({ ...base, reports: reports.slice(0, 2) }, NOW).score).toEqual({ average: 65, change: { kind: 'change', diff: 0 } });
  });

  it('says when the first scores are from this month, and when there are none', () => {
    const reports = [{ generated_at: '2026-11-02T10:00:00Z', overall_score: 72 }];
    expect(homeStats({ ...base, reports }, NOW).score).toEqual({ average: 72, change: { kind: 'new' } });
    expect(homeStats(base, NOW).score).toEqual({ average: null, change: { kind: 'none' } });
  });

  it('compares live minutes with the same days of last month, and only when last month had a session', () => {
    const live = [
      { started_at: '2026-10-03T15:00:00Z', consumed_minutes: 22 },
      { started_at: '2026-10-15T15:00:00Z', consumed_minutes: 31 },
      { started_at: '2026-11-02T15:00:00Z', consumed_minutes: 18 },
      { started_at: '2026-11-07T09:00:00Z', consumed_minutes: 2 },
    ];
    // Nov 1–7 10:00 (20 min) against Oct 1–7 10:00 (22 min); Oct 15 is outside the window.
    expect(homeStats({ ...base, live }, NOW).liveMinutes).toEqual({ thisMonth: 20, change: -2 });
    expect(homeStats({ ...base, live: live.slice(2) }, NOW).liveMinutes).toEqual({ thisMonth: 20, change: null });
  });
});

describe('scoreTrend', () => {
  it('keeps the latest scored interviews, oldest first', () => {
    const reports = Array.from({ length: 15 }, (_, i) => ({
      generated_at: new Date(Date.UTC(2026, 8, 1 + i * 3)).toISOString(),
      overall_score: i === 14 ? null : 50 + i,
    })).reverse();
    const points = scoreTrend(reports, 12);
    expect(points).toHaveLength(12);
    expect(points[0].score).toBe(52);
    expect(points.at(-1)?.score).toBe(63);
    expect(points.map((p) => p.at)).toEqual([...points.map((p) => p.at)].sort());
  });
});
