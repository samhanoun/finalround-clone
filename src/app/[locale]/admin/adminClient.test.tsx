import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import AdminClient from './AdminClient';

const TICKET = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@example.com',
  full_name: 'Ana',
  subject: 'Charged twice',
  description: 'I was charged twice this month.',
  category: 'billing',
  priority: 'medium',
  status: 'open',
  created_at: '2026-11-05T09:00:00Z',
};

const USERS = [
  { id: 'u-1', email: 'bo@example.com', full_name: 'Bo', avatar_url: null, created_at: '2026-10-01T00:00:00Z', subscription: null, suspended: false },
  { id: 'u-2', email: 'cy@example.com', full_name: null, avatar_url: null, created_at: '2026-10-02T00:00:00Z', subscription: null, suspended: true },
];

const SUBSCRIPTIONS = [
  { id: 'sub_running', user_id: 'u-1', email: 'bo@example.com', status: 'active', price_id: 'price_usd', current_period_end: '2026-12-01T00:00:00Z', cancel_at_period_end: false, created_at: '2026-10-01T00:00:00Z' },
  { id: 'sub_ending', user_id: 'u-2', email: 'cy@example.com', status: 'active', price_id: 'price_eur', current_period_end: '2026-12-02T00:00:00Z', cancel_at_period_end: true, created_at: '2026-10-02T00:00:00Z' },
  { id: 'sub_over', user_id: 'u-3', email: 'di@example.com', status: 'canceled', price_id: 'price_usd', current_period_end: '2026-09-01T00:00:00Z', cancel_at_period_end: false, created_at: '2026-08-01T00:00:00Z' },
];

const FLAG = { id: '44444444-4444-4444-8444-444444444444', user_id: 'u-1', user_email: 'bo@example.com', flag_type: 'chargeback', severity: 'high', description: 'Disputed a charge', resolved: false, created_at: '2026-11-01T00:00:00Z' };

let saved: Array<{ id: string; is_from_admin: boolean; content: string; created_at: string }> = [];
const requests: string[] = [];
const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
/** The answer to the next PATCH that isn't a ticket reply. */
let patchReply: { status: number; body: unknown } = { status: 200, body: { success: true } };
/** The first conversation load answers only once the reply has been saved (a slow first compile, say). */
let releaseFirstLoad: (() => void) | null = null;

beforeEach(() => {
  saved = [];
  requests.length = 0;
  patches.length = 0;
  patchReply = { status: 200, body: { success: true } };
  releaseFirstLoad = null;
  window.confirm = jest.fn(() => true);
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('/api/admin/analytics')) {
      return {
        ok: true,
        json: async () => ({
          period: { days: 30 },
          totals: { totalUsers: 1234, newUsers: 56, activeSubscriptions: 78, openTickets: 1, openFraudFlags: 2 },
        }),
      } as Response;
    }
    if (url.startsWith('/api/admin/tickets?ticket_id=')) {
      const first = requests.filter((r) => r.startsWith('GET /api/admin/tickets?ticket_id=')).length === 1;
      if (first) await new Promise<void>((resolve) => (releaseFirstLoad = resolve));
      return { ok: true, json: async () => ({ messages: [...saved] }) } as Response;
    }
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      if (url.startsWith('/api/admin/tickets') && body.action === 'reply') {
        saved.push({ id: `m${saved.length + 1}`, is_from_admin: true, content: body.data.content, created_at: '2026-11-07T10:00:00Z' });
        releaseFirstLoad?.();
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      patches.push({ url, body });
      return { ok: patchReply.status < 300, status: patchReply.status, json: async () => patchReply.body } as Response;
    }
    if (url.startsWith('/api/admin/tickets')) return { ok: true, json: async () => ({ tickets: [TICKET] }) } as Response;
    if (url.startsWith('/api/admin/users')) return { ok: true, json: async () => ({ users: USERS }) } as Response;
    if (url.startsWith('/api/admin/subscriptions')) return { ok: true, json: async () => ({ subscriptions: SUBSCRIPTIONS }) } as Response;
    if (url.startsWith('/api/admin/fraud')) return { ok: true, json: async () => ({ flags: [FLAG] }) } as Response;
    return { ok: false, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

function openTab(name: string) {
  const tabs = screen.getByRole('navigation', { name: 'Admin sections' });
  fireEvent.click(within(tabs).getByRole('button', { name: new RegExp(`^${name}`) }));
}

/** The table row that mentions `text`. */
async function rowWith(text: string) {
  return (await screen.findByText(text)).closest('tr') as HTMLElement;
}

describe('AdminClient', () => {
  it('shows admins every section, starting with the overview', async () => {
    render(<AdminClient role="admin" />);
    const tabs = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual([
      'Overview',
      'Users',
      'Subscriptions',
      'Fraud flags',
      'Support tickets',
    ]);
    await waitFor(() => expect(requests[0]).toBe('GET /api/admin/analytics?period=30d'));
  });

  it('shows the overview’s live figures, with no revenue made up from a count', async () => {
    render(<AdminClient role="admin" />);
    const figures = await screen.findByText('1,234');
    const list = figures.closest('dl') as HTMLElement;
    const pairs = within(list)
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]);
    expect(pairs).toEqual([
      ['Users', '1,234'],
      ['Sign-ups in the last 30 days', '56'],
      ['Active subscriptions', '78'],
      ['Open support tickets', '1'],
      ['Open fraud flags', '2'],
    ]);
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument();
  });

  it("starts support agents on tickets and leaves out the sections whose data they can't read", async () => {
    render(<AdminClient role="support_agent" />);
    const tabs = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['Support tickets', 'Users', 'Subscriptions']);
    expect(await screen.findByText('Charged twice')).toBeInTheDocument();
    expect(requests.some((r) => r.includes('/api/admin/analytics') || r.includes('/api/admin/fraud'))).toBe(false);
    // The topic is shown in words, not as its stored value.
    expect(screen.getByText('Billing and plans')).toBeInTheDocument();
  });

  it('shows a reply once, even when the first load of the conversation answers after it was saved', async () => {
    render(<AdminClient role="support_agent" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    const thread = screen.getByRole('region', { name: 'Ticket: Charged twice' });
    fireEvent.change(within(thread).getByRole('textbox', { name: 'Reply' }), { target: { value: 'Refunded the second charge' } });
    fireEvent.click(within(thread).getByRole('button', { name: 'Send reply' }));
    expect(await within(thread).findByText('Sent. The user was notified by email and in the app.')).toBeInTheDocument();
    await waitFor(() => expect(within(thread).getAllByText('Refunded the second charge')).toHaveLength(1));
    expect(within(thread).getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  });

  it('sends every action in one shape: the action, the id, and its own fields under data', async () => {
    render(<AdminClient role="super_admin" />);
    openTab('Users');
    const bo = await rowWith('Bo');
    fireEvent.click(within(bo).getByRole('button', { name: 'Make admin' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ url: '/api/admin/users', body: { action: 'set_admin', user_id: 'u-1', data: { role: 'admin' } } });

    openTab('Fraud flags');
    fireEvent.click(within(await rowWith('Disputed a charge')).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ url: '/api/admin/fraud', body: { action: 'suspend_user', flag_id: FLAG.id } });
    expect(window.confirm).toHaveBeenCalledWith('Suspend bo@example.com? They won\'t be able to sign in.');
  });

  it('only offers Make admin to super admins, and Unsuspend to suspended users', async () => {
    render(<AdminClient role="admin" />);
    openTab('Users');
    const bo = await rowWith('Bo');
    expect(within(bo).queryByRole('button', { name: 'Make admin' })).not.toBeInTheDocument();
    expect(within(bo).getByRole('button', { name: 'Suspend' })).toBeInTheDocument();

    const cy = (await screen.findByText('cy@example.com')).closest('tr') as HTMLElement;
    expect(within(cy).getByText('Suspended')).toBeInTheDocument();
    fireEvent.click(within(cy).getByRole('button', { name: 'Unsuspend' }));
    await waitFor(() => expect(patches).toEqual([{ url: '/api/admin/users', body: { action: 'unsuspend_user', user_id: 'u-2' } }]));
  });

  it('offers Cancel on a running subscription, Resume on one set to end, and nothing on one that ended', async () => {
    render(<AdminClient role="admin" />);
    openTab('Subscriptions');
    const running = await rowWith('bo@example.com');
    const ending = await rowWith('cy@example.com');
    const over = await rowWith('di@example.com');

    expect(within(ending).getByText('Ends at period end')).toBeInTheDocument();
    expect(within(over).queryByRole('button')).not.toBeInTheDocument();
    expect(within(running).queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();

    fireEvent.click(within(ending).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    fireEvent.click(within(await rowWith('bo@example.com')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches.map((p) => p.body)).toEqual([
      { action: 'resume', subscription_id: 'sub_ending' },
      { action: 'cancel', subscription_id: 'sub_running' },
    ]);
  });

  it('says why an action was refused when it can, and that it failed otherwise', async () => {
    render(<AdminClient role="admin" />);
    openTab('Subscriptions');
    patchReply = { status: 503, body: { error: 'billing_unavailable' } };
    fireEvent.click(within(await rowWith('bo@example.com')).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Stripe isn’t set up on this server, so subscriptions can’t be changed here.');

    patchReply = { status: 500, body: { error: 'action_failed' } };
    fireEvent.click(within(await rowWith('bo@example.com')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("That action didn't go through. Try again."));
  });
});
