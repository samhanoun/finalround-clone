import { cloneElement, type ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { DashboardClient } from '@/components/DashboardClient';
import { ScoreTrend } from '@/app/[locale]/dashboard/ScoreTrend';
import { ToastProvider } from '@/components/Toast';
import type { HomeSetup, NextUp } from '@/app/[locale]/dashboard/homeData';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));

// jsdom has no layout, so give the chart a fixed size.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 600, height: 260 }),
  };
});

const NOW = '2026-11-07T10:00:00Z';

const scheduled: NextUp = {
  source: 'scheduled',
  role: 'Staff Engineer',
  company: 'Acme',
  name: 'Staff engineer at Acme',
  at: '2026-11-12T14:00:00Z',
  round: 'system_design',
  goal: { id: 'g1', hasResume: true, resumeName: 'cv.pdf', hasJobDescription: false },
  jobId: 'j1',
};

function renderNext(next: NextUp | null, setup: HomeSetup = { resumeName: 'cv.pdf', liveSessions: 0 }) {
  return render(
    <ToastProvider>
      <DashboardClient next={next} setup={setup} now={NOW} />
    </ToastProvider>,
  );
}

describe('Home → Next up', () => {
  it('leads with the next interview, one primary action and one secondary', () => {
    renderNext(scheduled);
    const panel = screen.getByRole('region', { name: 'Staff Engineer at Acme' });
    expect(within(panel).getByText('System design')).toBeInTheDocument();
    expect(within(panel).getByText('in 5 days')).toBeInTheDocument();

    const live = within(panel).getByRole('link', { name: 'Start live session' });
    expect(live).toHaveAttribute('href', '/copilot/live?goal=g1');
    expect(live).toHaveClass('buttonPrimary');
    expect(within(panel).getByRole('button', { name: 'Practice for it' })).not.toHaveClass('buttonPrimary');
    expect(panel.querySelectorAll('.buttonPrimary')).toHaveLength(1);

    // What the goal has ready, and what it doesn't.
    expect(within(panel).getByText('Résumé: cv.pdf')).toBeInTheDocument();
    expect(within(panel).getByText('No job description yet')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Edit goal' })).toHaveAttribute('href', '/goals');
  });

  it('offers to make a goal for a job that has none', () => {
    renderNext({ ...scheduled, source: 'stage', at: null, round: null, goal: null });
    const panel = screen.getByRole('region', { name: 'Staff Engineer at Acme' });
    expect(within(panel).getByText('In the Interview stage, no date yet')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Start live session' })).toHaveAttribute('href', '/copilot/live');
    expect(within(panel).getByText('No goal for this job yet')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Make a goal' })).toHaveAttribute('href', '/goals?fromJob=j1');
  });

  it('walks a first run through résumé, goal and live session, with the next step as the one primary action', () => {
    renderNext(null, { resumeName: null, liveSessions: 0 });
    const panel = screen.getByRole('region', { name: 'Get ready for your next interview' });
    const steps = within(panel).getByRole('list', { name: 'Steps to get ready' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(within(panel).getByRole('link', { name: 'Add résumé' })).toHaveClass('buttonPrimary');
    expect(within(panel).getByRole('link', { name: 'New goal' })).not.toHaveClass('buttonPrimary');
    expect(within(panel).getByRole('link', { name: 'Start live session' })).not.toHaveClass('buttonPrimary');
  });

  it('marks the steps already done and moves the primary action on', () => {
    renderNext(null, { resumeName: 'cv.pdf', liveSessions: 2 });
    const panel = screen.getByRole('region', { name: 'Get ready for your next interview' });
    expect(within(panel).getByText('cv.pdf')).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: 'Add résumé' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'New goal' })).toHaveClass('buttonPrimary');
    expect(within(panel).getByText('2 live sessions so far')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Start live session' })).toHaveAttribute('href', '/copilot/live');
  });
});

describe('Home → practice score trend', () => {
  it('waits for two scored interviews before drawing a trend', () => {
    const { rerender } = render(<ScoreTrend points={[]} />);
    expect(screen.getByText('Your score trend starts after two scored practice interviews.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Practice an interview' })).toHaveAttribute('href', '/interview');

    rerender(<ScoreTrend points={[{ at: '2026-11-03T18:00:00Z', score: 72 }]} />);
    expect(screen.getByText(/One scored practice interview so far: 72 out of 100/)).toBeInTheDocument();
  });

  it('leads with the latest score and its change from the one before', () => {
    render(
      <ScoreTrend
        points={[
          { at: '2026-10-21T12:00:00Z', score: 68 },
          { at: '2026-11-03T12:00:00Z', score: 70 },
          { at: '2026-11-06T12:00:00Z', score: 76 },
        ]}
      />,
    );
    expect(screen.getByText('Latest 3 scored practice interviews')).toBeInTheDocument();
    expect(screen.getByText('+6 vs your previous interview')).toBeInTheDocument();
    // Screen readers get the same points as a list.
    const list = screen.getByRole('list', { name: 'Practice scores, oldest first' });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Oct 21: 68 out of 100',
      'Nov 3: 70 out of 100',
      'Nov 6: 76 out of 100',
    ]);
  });
});
