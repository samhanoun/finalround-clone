import { fireEvent, render, screen, within } from '@testing-library/react';
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
  { id: 'm1', role: 'owner', status: 'active', joined_at: '2026-09-01T00:00:00Z', user_full_name: 'Ana Ruiz', user_email: 'ana@acme.dev' },
  { id: 'm2', role: 'member', status: 'active', joined_at: '2026-10-03T00:00:00Z', user_full_name: 'Marcus Webb', user_email: 'marcus@acme.dev' },
];
const INVITES = [{ id: 'i1', email: 'sam@acme.dev', role: 'member', status: 'pending', expires_at: '2026-11-12T00:00:00Z', invitePath: '/teams/join/abc' }];
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
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url === '/api/teams/invitations') return ok({ invitations: [] });
    if (url.endsWith('/members')) return ok({ members: MEMBERS });
    if (url.endsWith('/analytics')) return ok({ stats: { totalMembers: 2, activeMembers: 2, pendingInvitations: 1, totalInterviews: 12, interviewsThisMonth: 3 } });
    if (url.endsWith('/invitations') && method === 'POST') return ok({ invitation: { invitePath: '/teams/join/new' }, emailSent: false }, 201);
    if (url.endsWith('/invitations')) return ok({ invitations: INVITES });
    if (url.endsWith('/sso') && method === 'PUT') {
      return ok({ error: 'domain_unverified', records: [{ domain: 'acme.dev', type: 'TXT', name: '_apex-round-sso.acme.dev', value: 'apex-round-sso=abc123' }] }, 422);
    }
    if (url.endsWith('/sso')) return ok(SSO);
    return ok({});
  }) as unknown as typeof fetch;
});

function renderAs(role: OrganizationRole) {
  return render(<TeamsClient initialOrganization={ORG} role={role} />);
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
