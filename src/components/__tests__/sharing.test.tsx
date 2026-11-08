import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BadgesList } from '@/components/BadgesList';
import { ReferralPanel } from '@/components/ReferralPanel';

type Sent = { url: string; method: string; body?: Record<string, unknown> };
let sent: Sent[] = [];
let badgesStatus = 200;
let shareStatus = 200;

const BADGES = [
  // Stored with the old English title: the list shows the kind in the reader's language.
  { id: 'b1', badge_type: 'five_sessions', title: 'Five sessions', description: 'Old text', icon: null, awarded_at: '2026-11-07T10:00:00Z', metadata: {} },
  { id: 'b2', badge_type: 'job_applied', title: 'Applied', description: null, icon: null, awarded_at: '2026-11-06T10:00:00Z', metadata: {} },
];

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

beforeEach(() => {
  sent = [];
  badgesStatus = 200;
  shareStatus = 200;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  window.open = jest.fn() as unknown as typeof window.open;
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/badges') return badgesStatus === 200 ? json({ badges: BADGES }) : json({ error: 'Unauthorized' }, badgesStatus);
    if (url === '/api/referrals') {
      return json({ referral_code: { id: 'code-1', code: 'ABCD1234', referral_count: 0, conversion_count: 0 }, referrals: [] });
    }
    if (url === '/api/social/shares' && method === 'PUT') return json({ share_url: 'https://www.linkedin.com/shareArticle?mini=true' });
    if (url === '/api/social/shares' && method === 'POST') {
      return shareStatus === 200 ? json({ share: { id: 'share-1' } }) : json({ error: 'share_not_recorded' }, shareStatus);
    }
    return json({});
  }) as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

const recordedShares = () => sent.filter((request) => request.url === '/api/social/shares' && request.method === 'POST');

describe('BadgesList', () => {
  it('shows each badge in the reader’s language', async () => {
    render(<BadgesList />);
    expect(await screen.findByRole('button', { name: 'Badge: Five live sessions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Badge: Five live sessions' }));
    expect(screen.getByText('Finished five live sessions.')).toBeInTheDocument();
  });

  it('records a badge share once, as a badge share', async () => {
    render(<BadgesList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Badge: Applied' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share on LinkedIn' }));

    // The window opens inside the click (no network wait), so popup blockers let it through.
    expect(window.open).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?url=/),
      '_blank',
      'noopener,noreferrer,width=600,height=400',
    );
    await waitFor(() => expect(recordedShares()).toHaveLength(1));
    expect(recordedShares()[0].body).toEqual({
      share_type: 'badge',
      platform: 'linkedin',
      content_id: 'b2',
      content_title: 'I earned the "Applied" badge on Apex Round',
    });
  });

  it('says the badges didn’t load instead of claiming there are none', async () => {
    badgesStatus = 500;
    render(<BadgesList />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your achievements didn\'t load.');
    expect(screen.queryByText(/No badges yet/)).not.toBeInTheDocument();
  });
});

describe('ReferralPanel', () => {
  // jsdom can't open other sites: keep the links' default action from running.
  const stopNavigation = (event: MouseEvent) => {
    if ((event.target as Element | null)?.closest('a')) event.preventDefault();
  };
  beforeEach(() => document.addEventListener('click', stopNavigation));
  afterEach(() => document.removeEventListener('click', stopNavigation));

  it('records a referral share as one', async () => {
    render(<ReferralPanel />);
    const panel = await screen.findByRole('region', { name: 'Invite a friend' });
    fireEvent.click(await within(panel).findByRole('link', { name: 'LinkedIn' }));
    await waitFor(() => expect(recordedShares()).toHaveLength(1));
    expect(recordedShares()[0].body).toMatchObject({ share_type: 'referral', platform: 'linkedin', content_id: 'code-1' });
    expect(within(panel).queryByText('The share opened, but it wasn\'t recorded here.')).not.toBeInTheDocument();
  });

  it('says so when the share could not be recorded', async () => {
    shareStatus = 500;
    render(<ReferralPanel />);
    const panel = await screen.findByRole('region', { name: 'Invite a friend' });
    fireEvent.click(await within(panel).findByRole('link', { name: 'Share on X' }));
    expect(await within(panel).findByRole('status')).toHaveTextContent('The share opened, but it wasn\'t recorded here.');
    expect(console.error).toHaveBeenCalledWith('Failed to record share:', expect.any(Error));
  });
});
