import { render, screen } from '@testing-library/react';
import React from 'react';
import { UsageWidget } from '@/components/UsageWidget';

describe('UsageWidget', () => {
  it('renders heading (with mocked fetch)', async () => {
    const mock = {
      plan: 'Free',
      isPro: false,
      limits: {
        copilot_minutes_monthly: 10,
        copilot_session_minutes: 5,
        copilot_daily_minutes: 5,
        smart_mode_minutes_monthly: 0,
        resume_deep_reviews_monthly: 0,
      },
      usage: {
        copilot_minutes_monthly: 1,
        copilot_session_minutes: 0,
        copilot_daily_minutes: 0,
        smart_mode_minutes_monthly: 0,
        resume_deep_reviews_monthly: 0,
      },
    };

    // @ts-expect-error test mock
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => mock,
    }));

    render(<UsageWidget />);

    expect(await screen.findByText(/Usage & Limits/i)).toBeInTheDocument();
    expect(await screen.findByText(/Free Plan/i)).toBeInTheDocument();
  });
});
