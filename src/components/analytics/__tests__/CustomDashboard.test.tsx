import { cloneElement, type ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CustomDashboard } from '@/components/analytics/CustomDashboard';
import type { OverviewResponse } from '@/lib/analytics/overview';

// jsPDF needs browser APIs jsdom lacks.
jest.mock('@/lib/export', () => ({ exportToCSV: jest.fn(), exportToPDF: jest.fn() }));
const { exportToCSV } = jest.requireMock('@/lib/export') as { exportToCSV: jest.Mock };

// jsdom has no layout, so give the charts a fixed size.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 600, height: 260 }),
  };
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const OVERVIEW: OverviewResponse = {
  since: hoursAgo(181 * 24),
  truncated: false,
  liveSessions: [
    { started_at: hoursAgo(1), consumed_minutes: 18 },
    { started_at: hoursAgo(50), consumed_minutes: 24 },
  ],
  practiceInterviews: [{ created_at: hoursAgo(30) }],
  reports: [{ generated_at: hoursAgo(29), overall_score: 68 }],
};

const USAGE = {
  plan: 'Pro',
  isPro: true,
  limits: { copilot_minutes_monthly: 400 },
  usage: { copilot_minutes_monthly: 42 },
};

type Reply = { status: number; body?: unknown };

function mockFetch(overview: Reply, usage: Reply = { status: 200, body: USAGE }) {
  const fetchMock = jest.fn(async (url: string) => {
    const reply = url === '/api/usage' ? usage : overview;
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('CustomDashboard', () => {
  it("shows the signed-in user's own numbers", async () => {
    mockFetch({ status: 200, body: OVERVIEW });
    render(<CustomDashboard />);

    expect(await screen.findByText('Live minutes billed')).toBeInTheDocument();
    // Series names repeat in the chart legend and table, so find the tile's own label.
    const tile = (label: string) =>
      screen.getAllByText(label).find((el) => el.classList.contains('tile-label'))?.parentElement as HTMLElement;
    expect(tile('Live sessions')).toHaveTextContent('2');
    expect(tile('Live minutes billed')).toHaveTextContent('42');
    expect(tile('Practice interviews')).toHaveTextContent('1');
    expect(tile('Average score')).toHaveTextContent('68 / 100');
    expect(tile('Copilot minutes this month')).toHaveTextContent('42 of 400');
    expect(screen.getByRole('meter', { name: 'Copilot minutes used this month' })).toHaveAttribute('aria-valuenow', '42');

    // None of the old sample figures or platform-wide metrics.
    expect(screen.queryByText(/1,250|Total Users|Conversion Rate|User Distribution/)).not.toBeInTheDocument();
  });

  it('switches the range without refetching', async () => {
    const fetchMock = mockFetch({ status: 200, body: OVERVIEW });
    render(<CustomDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: '7 days' }));
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Daily activity')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '90 days' }));
    expect(screen.getByText('Weekly activity')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exports the buckets on screen as CSV', async () => {
    mockFetch({ status: 200, body: OVERVIEW });
    render(<CustomDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: '7 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    const [rows, filename] = exportToCSV.mock.calls[0];
    expect(filename).toBe('activity-last-7-days');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({
      period_start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      live_sessions: expect.any(Number),
      live_minutes: expect.any(Number),
      practice_interviews: expect.any(Number),
    });
    const sum = (key: string) => rows.reduce((total: number, row: Record<string, number>) => total + row[key], 0);
    expect(sum('live_sessions')).toBe(2);
    expect(sum('live_minutes')).toBe(42);
  });

  it('labels an account with no activity instead of showing numbers', async () => {
    mockFetch({ status: 200, body: { ...OVERVIEW, liveSessions: [], practiceInterviews: [], reports: [] } });
    render(<CustomDashboard />);

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a practice interview' })).toHaveAttribute('href', '/interview');
    expect(screen.queryByText('Live sessions')).not.toBeInTheDocument();
  });

  it('says when a period has no scored interviews', async () => {
    mockFetch({ status: 200, body: { ...OVERVIEW, reports: [] } });
    render(<CustomDashboard />);

    expect(await screen.findByText('No scored interviews in this period')).toBeInTheDocument();
    expect(screen.getByText(/No scored practice interviews in the last 30 days/)).toBeInTheDocument();
  });

  it('marks monthly usage unavailable rather than showing zero', async () => {
    mockFetch({ status: 200, body: OVERVIEW }, { status: 500, body: { error: 'nope' } });
    render(<CustomDashboard />);

    expect(await screen.findByText('Monthly usage is unavailable right now')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in', async () => {
    mockFetch({ status: 401, body: { error: 'Unauthorized' } });
    render(<CustomDashboard />);

    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth');
  });

  it('offers a retry when loading fails', async () => {
    const fetchMock = mockFetch({ status: 500, body: { error: 'boom' } });
    render(<CustomDashboard />);

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load your activity.");
    mockFetch({ status: 200, body: OVERVIEW });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Live minutes billed')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
