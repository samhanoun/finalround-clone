import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { BillingSection } from './BillingSection';

jest.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
  useSearchParams: () => new URLSearchParams(),
}));

function mockUsage(overrides: Record<string, unknown> = {}) {
  const usage = {
    plan: 'Free',
    isPro: false,
    limits: { copilot_minutes_monthly: 10, copilot_session_minutes: 10, copilot_daily_minutes: 10, resume_deep_reviews_monthly: 0 },
    usage: { copilot_minutes_monthly: 9, copilot_session_minutes: 3, copilot_daily_minutes: 3, resume_deep_reviews_monthly: 0 },
    ...overrides,
  };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => usage })) as unknown as typeof fetch;
}

describe('BillingSection', () => {
  it('meters what the plan counts, with no Smart mode meter or claim', async () => {
    mockUsage();
    render(<BillingSection />);
    const meters = await screen.findByRole('list', { name: 'Usage this month' });
    expect(within(meters).getAllByRole('meter').map((meter) => meter.getAttribute('aria-label'))).toEqual([
      'Live copilot this month',
      'Live copilot today',
      'Per session',
      'Résumé reviews this month',
    ]);
    expect(within(meters).getByRole('meter', { name: 'Live copilot this month' })).toHaveAttribute('aria-valuetext', '9 / 10 min');
    expect(screen.queryByText(/Smart/)).not.toBeInTheDocument();
    expect(screen.getByText('Pro raises the limits to 400 minutes a month, 30-minute sessions, 45 minutes a day and 10 résumé reviews a month')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
  });

  it('treats a Tester plan as paid: billing to manage, no upgrade', async () => {
    mockUsage({ plan: 'Tester', isPro: true });
    render(<BillingSection />);
    expect(await screen.findByText('Tester plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).not.toBeInTheDocument();
  });
});
