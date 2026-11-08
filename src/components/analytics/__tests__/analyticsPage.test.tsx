import { render, screen, within } from '@testing-library/react';
import AnalyticsPage from '@/app/[locale]/analytics/page';

jest.mock('next/navigation', () => ({
  usePathname: () => '/en/analytics',
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));
jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  }),
}));
// The overview and the data checks load their own data; here only where they appear matters.
jest.mock('@/components/analytics/CustomDashboard', () => ({ CustomDashboard: ({ intro }: { intro?: string }) => <p>{intro}</p> }));
jest.mock('@/components/AnalyticsReconciliation', () => ({ AnalyticsReconciliation: () => <p>reconciliation panel</p> }));

describe('Analytics page', () => {
  it('shows the four views as tabs, with Overview current', async () => {
    render(await AnalyticsPage({ searchParams: Promise.resolve({}) }));
    const tabs = screen.getByRole('navigation', { name: 'Analytics views' });
    expect(within(tabs).getAllByRole('link').map((link) => link.textContent)).toEqual(['Overview', 'Job search', 'Week by week', 'Reports']);
    expect(within(tabs).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Your live sessions, practice interviews and scores over time.')).toBeInTheDocument();
  });

  it('keeps the data checks out of the way unless ?debug=1', async () => {
    const { unmount } = render(await AnalyticsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText('reconciliation panel')).not.toBeInTheDocument();
    unmount();

    render(await AnalyticsPage({ searchParams: Promise.resolve({ debug: '1' }) }));
    expect(within(screen.getByRole('region', { name: 'Data checks' })).getByText('reconciliation panel')).toBeInTheDocument();
  });
});
