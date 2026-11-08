import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import TeamsClient from './TeamsClient';
import type { Organization, OrganizationRole } from '@/lib/organizations';

jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const ORG = {
  id: 'org-1',
  name: 'Acme engineering',
  slug: 'acme-engineering',
  logo_url: null,
  plan: 'team',
  sso_enabled: true,
  sso_provider: 'saml',
  sso_config: {},
  settings: {},
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
} as Organization;

const MEMBERS = [
  {
    id: 'm1',
    user_id: 'u-ana',
    role: 'owner',
    status: 'active',
    joined_at: '2026-09-01T00:00:00Z',
    user_full_name: 'Ana Ruiz',
    user_email: 'ana@acme.dev',
    user_avatar_url: 'https://cdn.example/ana.png',
  },
  { id: 'm2', user_id: 'u-marcus', role: 'member', status: 'active', joined_at: '2026-10-03T00:00:00Z', user_full_name: 'Marcus Webb', user_email: 'marcus@acme.dev' },
  { id: 'm3', user_id: 'u-lee', role: 'admin', status: 'active', joined_at: '2026-10-05T00:00:00Z', user_full_name: 'Lee Park', user_email: 'lee@acme.dev' },
];
const STATS = {
  totalMembers: 3,
  activeMembers: 3,
  pendingInvitations: 1,
  practiceInterviews: { total: 12, thisMonth: 3 },
  liveSessions: { total: 4, thisMonth: 0 },
};
let analyticsStatus = 200;
let membersStatus = 200;
/** An error code the members PATCH or the invitation POST answers with (403), instead of succeeding. */
let patchError: string | null = null;
let inviteError: string | null = null;
const INVITES = [
  { id: 'i1', email: 'sam@acme.dev', role: 'member', status: 'pending', expires_at: '2026-11-12T00:00:00Z', invitePath: '/teams/join/abc' },
  { id: 'i2', email: 'kai@acme.dev', role: 'admin', status: 'pending', expires_at: '2026-11-12T00:00:00Z', invitePath: '/teams/join/def' },
];
const SSO = {
  enabled: true,
  domains: ['acme.dev'],
  metadataUrl: 'https://acme.okta.com/metadata',
  manageable: true,
  serviceProvider: { entityId: 'https://auth.example/sso/metadata', metadataUrl: 'https://auth.example/sso/metadata?download=true', acsUrl: 'https://auth.example/sso/acs', nameIdFormat: 'email' },
};

let requests: Array<{ url: string; method: string; body?: unknown }> = [];

beforeEach(() => {
  requests = [];
  analyticsStatus = 200;
  membersStatus = 200;
  patchError = null;
  inviteError = null;
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url === '/api/teams/invitations') return ok({ invitations: [] });
    if (url.endsWith('/members') && method === 'PATCH') return patchError ? ok({ error: patchError }, 403) : ok({ success: true });
    if (url.endsWith('/members')) return membersStatus === 200 ? ok({ members: MEMBERS }) : ok({ error: 'Failed to fetch members' }, membersStatus);
    if (url.endsWith('/analytics')) return analyticsStatus === 200 ? ok({ stats: STATS }) : ok({ error: 'Forbidden' }, analyticsStatus);
    if (url.endsWith('/invitations') && method === 'POST') {
      return inviteError ? ok({ error: inviteError }, 403) : ok({ invitation: { invitePath: '/teams/join/new' }, emailSent: false }, 201);
    }
    if (url.endsWith('/invitations')) return ok({ invitations: INVITES });
    if (url.endsWith('/sso') && method === 'PUT') {
      return ok({ error: 'domain_unverified', records: [{ domain: 'acme.dev', type: 'TXT', name: '_apex-round-sso.acme.dev', value: 'apex-round-sso=abc123' }] }, 422);
    }
    if (url.endsWith('/sso')) return ok(SSO);
    return ok({});
  }) as unknown as typeof fetch;
});

function renderAs(role: OrganizationRole, userId?: string) {
  return render(<TeamsClient initialOrganization={ORG} role={role} userId={userId} />);
}

describe('TeamsClient', () => {
  it('shows the team, its members with quiet roles, and the owner-only sections', async () => {
    renderAs('owner');
    expect(screen.getByRole('heading', { name: 'Acme engineering' })).toBeInTheDocument();
    const members = await screen.findByRole('region', { name: /Members/ });
    expect(await within(members).findByText('Owner')).toBeInTheDocument();
    expect(within(members).getByRole('combobox', { name: 'Role for marcus@acme.dev' })).toHaveValue('member');
    expect(within(members).getByRole('button', { name: 'Remove Marcus Webb' })).toBeInTheDocument();

    expect(await screen.findByText('sam@acme.dev')).toBeInTheDocument();
    expect(await screen.findByText('https://auth.example/sso/acs')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Danger zone' })).toBeInTheDocument();
  });

  it('invites from the inline form and shows the link to share', async () => {
    renderAs('owner');
    const form = await screen.findByRole('form', { name: 'Invite someone' });
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'jo@acme.dev' } });
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'admin' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText(/Invitation created for jo@acme.dev/)).toBeInTheDocument();
    expect(requests.find((r) => r.method === 'POST')).toMatchObject({ url: '/api/teams/org-1/invitations', body: { email: 'jo@acme.dev', role: 'admin' } });
  });

  it('shows the DNS record to add when a domain is not proven yet', async () => {
    renderAs('owner');
    const save = await screen.findByRole('button', { name: 'Save changes' });
    fireEvent.click(save);
    expect(await screen.findByText('_apex-round-sso.acme.dev')).toBeInTheDocument();
    expect(screen.getByText('apex-round-sso=abc123')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('First prove you own each domain');
  });

  it('shows the members’ practice interviews and live sessions, each with this month', async () => {
    renderAs('owner');
    const stats = await screen.findByText('Practice interviews');
    const practice = stats.closest('div') as HTMLElement;
    await waitFor(() => expect(practice).toHaveTextContent('12'));
    expect(practice).toHaveTextContent('+3 this month');
    const live = screen.getByText('Live sessions').closest('div') as HTMLElement;
    expect(live).toHaveTextContent('4');
    expect(live).toHaveTextContent('None this month');
    expect(screen.getByText('Members', { selector: 'dt' }).closest('div')).toHaveTextContent('3');
  });

  it('shows a dash, not zeros, when the figures don’t load', async () => {
    analyticsStatus = 500;
    renderAs('member');
    await screen.findByText('Marcus Webb');
    const practice = screen.getByText('Practice interviews').closest('div') as HTMLElement;
    expect(practice).toHaveTextContent('—');
    expect(practice).not.toHaveTextContent('0');
  });

  it('says the team didn’t load instead of showing an empty member list', async () => {
    membersStatus = 500;
    renderAs('owner');
    expect(await screen.findByText('The team didn\'t load. Reload the page to try again.')).toBeInTheDocument();
    expect(screen.queryByText('No members yet. Invite someone to get started.')).not.toBeInTheDocument();
  });

  it('shows each member’s profile photo, with the initial when there is none or it doesn’t load', async () => {
    const { container } = renderAs('owner');
    await screen.findByText('Marcus Webb');
    const photo = container.querySelector('img') as HTMLImageElement;
    expect(photo).toHaveAttribute('src', 'https://cdn.example/ana.png');
    expect(photo).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(container.querySelectorAll('img')).toHaveLength(1);
    const marcusRow = screen.getByText('Marcus Webb').closest('li') as HTMLElement;
    expect(within(marcusRow).getByText('M')).toBeInTheDocument();

    fireEvent.error(photo);
    expect(container.querySelector('img')).toBeNull();
    expect(within(screen.getByText('Ana Ruiz').closest('li') as HTMLElement).getByText('A')).toBeInTheDocument();
  });

  it('offers no role change or removal on your own row', async () => {
    renderAs('admin', 'u-lee');
    const members = await screen.findByRole('region', { name: /Members/ });
    const own = (await within(members).findByText('Lee Park')).closest('li') as HTMLElement;
    expect(within(own).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'Remove Lee Park' })).not.toBeInTheDocument();
    expect(within(own).getByText('Admin')).toBeInTheDocument();
    // Other members can still be managed.
    fireEvent.change(within(members).getByRole('combobox', { name: 'Role for marcus@acme.dev' }), { target: { value: 'viewer' } });
    await waitFor(() =>
      expect(requests).toContainEqual({ url: '/api/teams/org-1/members', method: 'PATCH', body: { member_id: 'm2', action: 'update_role', role: 'viewer' } }),
    );
  });

  it('leaves admins to the owner: an admin manages members and viewers only', async () => {
    renderAs('admin', 'u-kim');
    const members = await screen.findByRole('region', { name: /Members/ });
    const lee = (await within(members).findByText('Lee Park')).closest('li') as HTMLElement;
    expect(within(lee).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(lee).queryByRole('button', { name: 'Remove Lee Park' })).not.toBeInTheDocument();
    expect(within(lee).getByText('Admin')).toBeInTheDocument();

    const marcusRole = within(members).getByRole('combobox', { name: 'Role for marcus@acme.dev' });
    expect(within(marcusRole).getAllByRole('option').map((option) => option.textContent)).toEqual(['Member', 'Viewer']);
    expect(within(members).getByRole('button', { name: 'Remove Marcus Webb' })).toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'Invite someone' });
    const inviteRoles = within(within(form).getByLabelText('Role')).getAllByRole('option') as HTMLOptionElement[];
    expect(inviteRoles.map((option) => option.value)).toEqual(['member', 'viewer']);

    expect(await screen.findByText('kai@acme.dev')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel the invitation to kai@acme.dev' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel the invitation to sam@acme.dev' })).toBeInTheDocument();
  });

  it('lets the owner manage admins and their invitations', async () => {
    renderAs('owner', 'u-ana');
    const members = await screen.findByRole('region', { name: /Members/ });
    const leeRole = await within(members).findByRole('combobox', { name: 'Role for lee@acme.dev' });
    expect(within(leeRole).getAllByRole('option').map((option) => option.textContent)).toEqual(['Admin', 'Member', 'Viewer']);
    expect(within(members).getByRole('button', { name: 'Remove Lee Park' })).toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'Invite someone' });
    const inviteRoles = within(within(form).getByLabelText('Role')).getAllByRole('option') as HTMLOptionElement[];
    expect(inviteRoles.map((option) => option.value)).toEqual(['member', 'admin', 'viewer']);
    expect(await screen.findByRole('button', { name: 'Cancel the invitation to kai@acme.dev' })).toBeInTheDocument();
  });

  it('says only the owner can change an admin when the page was out of date', async () => {
    patchError = 'owner_only';
    renderAs('admin', 'u-kim');
    const members = await screen.findByRole('region', { name: /Members/ });
    fireEvent.change(await within(members).findByRole('combobox', { name: 'Role for marcus@acme.dev' }), { target: { value: 'viewer' } });
    expect(await screen.findByText('Only the team owner can change or remove an admin.')).toHaveAttribute('role', 'alert');
  });

  it('says when the address already has an invitation as admin', async () => {
    inviteError = 'admin_invitation';
    renderAs('admin', 'u-kim');
    const form = await screen.findByRole('form', { name: 'Invite someone' });
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'kai@acme.dev' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByText('kai@acme.dev has an invitation as admin, which only the team owner can change.')).toHaveAttribute('role', 'alert');
  });

  it('keeps invitations, single sign-on and the danger zone from members who can’t manage them', async () => {
    renderAs('member');
    const members = await screen.findByRole('region', { name: /Members/ });
    expect(await within(members).findByText('Marcus Webb')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Invite someone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Single sign-on/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Danger zone' })).not.toBeInTheDocument();
    expect(screen.getByText('Only the team owner can change these')).toBeInTheDocument();
    expect(requests.some((r) => r.url.endsWith('/sso') || r.url.endsWith('/org-1/invitations'))).toBe(false);
  });
});
