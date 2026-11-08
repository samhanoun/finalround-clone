import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { UsageWidget } from '@/components/UsageWidget';

jest.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/en/dashboard',
}));

function mockUsage(overrides: Record<string, unknown> = {}) {
  const usage = {
    plan: 'Free',
    isPro: false,
    limits: { copilot_minutes_monthly: 10, copilot_session_minutes: 10, copilot_daily_minutes: 10, resume_deep_reviews_monthly: 0 },
    usage: { copilot_minutes_monthly: 1, copilot_session_minutes: 0, copilot_daily_minutes: 0, resume_deep_reviews_monthly: 0 },
    ...overrides,
  };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => usage })) as unknown as typeof fetch;
}

describe('UsageWidget', () => {
  it('renders heading (with mocked fetch)', async () => {
    mockUsage();
    render(<UsageWidget />);

    expect(await screen.findByText(/Usage this month/i)).toBeInTheDocument();
    expect(await screen.findByText(/Free Plan/i)).toBeInTheDocument();
  });

  it('shows the four meters there are, and no Smart mode', async () => {
    mockUsage();
    render(<UsageWidget />);
    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem').map((item) => item.firstChild?.textContent)).toEqual([
      'Live copilot, this month',
      'Per session',
      'Live copilot, today',
      'Résumé reviews, this month',
    ]);
    expect(screen.queryByText(/Smart/)).not.toBeInTheDocument();
    expect(screen.getByText('Pro raises the limits to 400 minutes a month, 30-minute sessions, 45 minutes a day and 10 résumé reviews a month.')).toBeInTheDocument();
  });

  it('offers no upgrade on a paid plan such as Tester', async () => {
    mockUsage({ plan: 'Tester', isPro: true });
    render(<UsageWidget />);
    expect(await screen.findByText('Tester plan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
  });
});
