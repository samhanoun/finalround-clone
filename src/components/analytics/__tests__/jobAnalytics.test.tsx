import { cloneElement, type ReactElement } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FunnelVisualization } from '@/components/analytics/FunnelVisualization';
import { WeeklyActivity } from '@/components/analytics/WeeklyActivity';
import type { JobFunnel, WeekActivity } from '@/lib/analytics/jobSearch';

// jsPDF needs browser APIs jsdom lacks.
jest.mock('@/lib/export', () => ({ exportToCSV: jest.fn(), exportToPDF: jest.fn() }));

// jsdom has no layout, so give the charts a fixed size.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 600, height: 260 }),
  };
});

function replyWith(body: unknown) {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
}

const FUNNEL: JobFunnel = {
  stages: [
    { key: 'tracked', count: 7, fromPrevious: null },
    { key: 'applied', count: 5, fromPrevious: 71.4 },
    { key: 'interviewing', count: 1, fromPrevious: 20 },
    { key: 'offer', count: 0, fromPrevious: 0 },
  ],
  total: 7,
  rejected: 1,
};

describe('Job search funnel', () => {
  it('lists each stage with its count, a thin bar and the share of the stage before', async () => {
    replyWith(FUNNEL);
    render(<FunnelVisualization />);

    const list = (await screen.findByText('Tracked')).closest('ol') as HTMLElement;
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('Applied5');
    expect(rows[1]).toHaveTextContent('71.4% of the stage before');
    // A stage at zero draws no bar at all.
    expect(rows[3].querySelector('.funnelBar')).toBeNull();
    expect(rows[2].querySelector('.funnelBar')).not.toBeNull();
    expect(screen.getByText(/1 rejected so far/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();
  });

  it('points an empty board to the Jobs page, without exports', async () => {
    replyWith({ stages: FUNNEL.stages.map((s) => ({ ...s, count: 0 })), total: 0, rejected: 0 });
    render(<FunnelVisualization />);

    expect(await screen.findByRole('link', { name: 'Open the Jobs board' })).toHaveAttribute('href', '/jobs');
    expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument();
  });
});

const week = (date: string, over: Partial<WeekActivity> = {}): WeekActivity => ({
  week: date,
  practice: 0,
  averageScore: null,
  liveSessions: 0,
  liveMinutes: 0,
  applied: 0,
  ...over,
});

const WEEKS: WeekActivity[] = [
  week('2026-09-14'),
  week('2026-09-21', { practice: 1, averageScore: 58 }),
  week('2026-09-28', { practice: 1, averageScore: 61 }),
  week('2026-10-05', { practice: 1, averageScore: 64 }),
  week('2026-10-12', { practice: 1, averageScore: 62, liveSessions: 1, liveMinutes: 31 }),
  week('2026-10-19', { practice: 1, averageScore: 68, applied: 1 }),
  week('2026-10-26', { practice: 1, averageScore: 71, applied: 2 }),
  week('2026-11-02', { practice: 4, averageScore: 73, liveSessions: 3, liveMinutes: 20, applied: 1 }),
];

describe('Week by week', () => {
  it('shows one activity at a time, with this week against last week beside it', async () => {
    replyWith({ weeks: WEEKS });
    render(<WeeklyActivity />);

    const metrics = await screen.findByRole('group', { name: 'Activity to show' });
    expect(within(metrics).getByRole('button', { name: 'Practice interviews' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(metrics).getByRole('button', { name: 'Live minutes' }));
    expect(within(metrics).getByRole('button', { name: 'Live minutes' })).toHaveAttribute('aria-pressed', 'true');

    const thisWeek = screen.getByText('This week so far').parentElement as HTMLElement;
    const practice = within(thisWeek).getByText('Practice interviews').parentElement as HTMLElement;
    expect(practice).toHaveTextContent('4');
    expect(practice).toHaveTextContent('1 last week');
    const score = within(thisWeek).getByText('Average score (of 100)').parentElement as HTMLElement;
    expect(score).toHaveTextContent('73');
    expect(score).toHaveTextContent('71 last week');
  });

  it('keeps every week in a table view, with a dash where nothing was scored', async () => {
    replyWith({ weeks: WEEKS });
    render(<WeeklyActivity />);

    const table = (await screen.findByRole('table')) as HTMLTableElement;
    expect(within(table).getAllByRole('row')).toHaveLength(WEEKS.length + 1);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('–');
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();
  });

  it('says so when nothing happened in the last 8 weeks', async () => {
    replyWith({ weeks: WEEKS.map((w) => week(w.week)) });
    render(<WeeklyActivity />);

    expect(await screen.findByText(/Nothing in the last 8 weeks yet/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Activity to show' })).not.toBeInTheDocument();
  });
});
