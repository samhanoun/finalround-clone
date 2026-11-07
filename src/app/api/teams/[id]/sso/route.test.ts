import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/organizations', () => ({
  getServerOrganizationClient: jest.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) } })),
  checkOrganizationAccess: jest.fn(async () => true),
}));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/sso', () => ({
  ...jest.requireActual('@/lib/sso'),
  registerSamlProvider: jest.fn(async () => 'provider-1'),
  updateSamlProvider: jest.fn(async () => undefined),
}));
jest.mock('@/lib/ssoVerification', () => ({
  ...jest.requireActual('@/lib/ssoVerification'),
  missingVerifications: jest.fn(),
}));

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const sso = jest.requireMock('@/lib/sso') as { registerSamlProvider: jest.Mock; updateSamlProvider: jest.Mock };
const { missingVerifications } = jest.requireMock('@/lib/ssoVerification') as { missingVerifications: jest.Mock };

const TEAM = 'team-1';
type Org = { sso_enabled: boolean; sso_provider: string | null; sso_config: Record<string, unknown> | null };

function mockOrg(org: Org | null) {
  const updates: unknown[] = [];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = async () => ({ data: org, error: null });
  builder.update = (row: unknown) => {
    updates.push(row);
    return { eq: async () => ({ error: null }) };
  };
  createAdminClient.mockReturnValue({ from: () => builder });
  return updates;
}

async function put(body: unknown) {
  const route = await import('./route');
  const res = (await route.PUT({ json: async () => body } as unknown as NextRequest, { params: Promise.resolve({ id: TEAM }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

const METADATA = { metadataUrl: 'https://idp.acme.com/metadata' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-for-tests';
  process.env.SUPABASE_MANAGEMENT_TOKEN = 'sbp_test';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://repgqysbgrjkcpzbyqpe.supabase.co';
});

describe('PUT /api/teams/[id]/sso', () => {
  it('refuses public email domains before anything reaches Supabase', async () => {
    mockOrg(null);
    const { status, body } = await put({ domains: ['acme.com', 'Gmail.com'], ...METADATA });
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'public_domain', domains: ['gmail.com'] });
    expect(missingVerifications).not.toHaveBeenCalled();
    expect(sso.registerSamlProvider).not.toHaveBeenCalled();
  });

  it('returns the DNS records to add while a domain is unproven, and registers nothing', async () => {
    const updates = mockOrg(null);
    const records = [{ domain: 'acme.com', type: 'TXT', name: '_apex-round-sso.acme.com', value: 'apex-round-sso=abc' }];
    missingVerifications.mockResolvedValue(records);
    const { status, body } = await put({ domains: ['acme.com'], ...METADATA });
    expect(status).toBe(422);
    expect(body).toEqual({ error: 'domain_unverified', records });
    expect(missingVerifications).toHaveBeenCalledWith(TEAM, ['acme.com']);
    expect(sso.registerSamlProvider).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('registers the identity provider once every domain is proven', async () => {
    const updates = mockOrg(null);
    missingVerifications.mockResolvedValue([]);
    const { status } = await put({ domains: ['acme.com'], ...METADATA });
    expect(status).toBe(200);
    expect(sso.registerSamlProvider).toHaveBeenCalledWith(expect.objectContaining({ domains: ['acme.com'] }));
    expect(updates[0]).toMatchObject({ sso_enabled: true, sso_config: { provider_id: 'provider-1', domains: ['acme.com'] } });
  });

  it('only checks domains the team has not already proven', async () => {
    mockOrg({ sso_enabled: true, sso_provider: 'saml', sso_config: { provider_id: 'provider-1', domains: ['acme.com'] } });
    missingVerifications.mockResolvedValue([]);
    await put({ domains: ['acme.com', 'acme.io'], ...METADATA });
    expect(missingVerifications).toHaveBeenCalledWith(TEAM, ['acme.io']);
    expect(sso.updateSamlProvider).toHaveBeenCalledWith('provider-1', expect.objectContaining({ domains: ['acme.com', 'acme.io'] }));
  });
});
