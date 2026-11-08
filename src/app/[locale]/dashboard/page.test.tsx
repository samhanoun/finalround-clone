import { render, screen } from '@testing-library/react';
import React from 'react';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/badges', () => ({ syncBadgesQuietly: jest.fn(async () => []) }));
jest.mock('./homeData', () => ({ loadHome: jest.fn() }));
jest.mock('@/i18n/routing', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  redirect: jest.fn(),
}));
function stub(name: string) {
  function Stub() {
    return <p>{name}</p>;
  }
  return Stub;
}
function passThrough({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
jest.mock('@/components/AppShell', () => ({ AppShell: passThrough }));
jest.mock('@/components/RequireAuth', () => ({ RequireAuth: passThrough }));
jest.mock('@/components/DashboardClient', () => ({ DashboardClient: stub('next up') }));
jest.mock('@/components/UsageWidget', () => ({ UsageWidget: stub('usage') }));
jest.mock('@/components/DashboardStats', () => ({ DashboardStats: stub('stats') }));
jest.mock('@/components/RecentActivity', () => ({ RecentActivity: stub('activity') }));
jest.mock('@/components/QuickActions', () => ({ QuickActions: stub('quick actions') }));
jest.mock('@/components/BadgesList', () => ({ BadgesList: stub('achievements') }));
jest.mock('@/components/ReferralPanel', () => ({ ReferralPanel: stub('referrals') }));
jest.mock('./ScoreTrend', () => ({ ScoreTrend: stub('trend') }));

import DashboardPage from './page';

const { createClient } = jest.requireMock('@/lib/supabase/server') as { createClient: jest.Mock };
const { syncBadgesQuietly } = jest.requireMock('@/lib/badges') as { syncBadgesQuietly: jest.Mock };
const { loadHome } = jest.requireMock('./homeData') as { loadHome: jest.Mock };

const HOME = { next: null, setup: { resumeName: null, liveSessions: 0 }, stats: {}, trend: [], sessions: [], resumes: [], activity: {} };

function signedIn(user: { id: string } | null) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { onboarding_completed: true } }) }) }) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  loadHome.mockResolvedValue(HOME);
});

describe('Home', () => {
  it('awards the badges earned since the last visit while it loads, before Achievements reads them', async () => {
    signedIn({ id: 'user-1' });
    render(await DashboardPage());
    expect(syncBadgesQuietly).toHaveBeenCalledWith('user-1');
    expect(loadHome).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.any(Date));
    expect(screen.getByText('achievements')).toBeInTheDocument();
  });

  it('syncs nothing for a signed-out visitor', async () => {
    signedIn(null);
    await DashboardPage();
    expect(syncBadgesQuietly).not.toHaveBeenCalled();
  });
});
