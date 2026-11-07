jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

import {
  domainFromEmail,
  isSsoManageable,
  joinSsoOrganization,
  normalizeDomains,
  projectRef,
  registerSamlProvider,
  removeSamlProvider,
  serviceProviderInfo,
  SsoSetupError,
  ssoProviderIdOf,
  updateSamlProvider,
} from '@/lib/sso';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

const URL_ENV = 'https://repgqysbgrjkcpzbyqpe.supabase.co';
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_ENV;
  process.env.SUPABASE_MANAGEMENT_TOKEN = 'sbp_test';
  delete process.env.SUPABASE_PROJECT_REF;
  global.fetch = fetchMock as unknown as typeof fetch;
});

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe('configuration', () => {
  it('reads the project from the Supabase URL and gives the service provider details', () => {
    expect(projectRef()).toBe('repgqysbgrjkcpzbyqpe');
    expect(isSsoManageable()).toBe(true);
    expect(serviceProviderInfo()).toEqual({
      entityId: `${URL_ENV}/auth/v1/sso/saml/metadata`,
      metadataUrl: `${URL_ENV}/auth/v1/sso/saml/metadata?download=true`,
      acsUrl: `${URL_ENV}/auth/v1/sso/saml/acs`,
      nameIdFormat: 'emailAddress',
    });
  });

  it('needs the management token', () => {
    delete process.env.SUPABASE_MANAGEMENT_TOKEN;
    expect(isSsoManageable()).toBe(false);
  });

  it('cleans domains', () => {
    expect(normalizeDomains(['@Acme.com', 'acme.com', ' eu.acme.com ', 'not a domain', '-bad.com'])).toEqual(['acme.com', 'eu.acme.com']);
    expect(domainFromEmail('Sam@Acme.COM')).toBe('acme.com');
    expect(domainFromEmail('nope')).toBeNull();
  });
});

describe('Management API calls', () => {
  it('registers a SAML provider for the domains', async () => {
    reply(201, { id: 'prov-1' });
    expect(await registerSamlProvider({ metadataUrl: 'https://idp.acme.com/metadata', domains: ['acme.com'] })).toBe('prov-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.supabase.com/v1/projects/repgqysbgrjkcpzbyqpe/config/auth/sso/providers');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer sbp_test');
    expect(JSON.parse(init.body)).toEqual({ type: 'saml', metadata_url: 'https://idp.acme.com/metadata', domains: ['acme.com'] });
  });

  it('updates and removes a provider', async () => {
    reply(200, {});
    await updateSamlProvider('prov-1', { metadataXml: '<xml/>', domains: ['acme.com'] });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/providers\/prov-1$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ metadata_xml: '<xml/>', domains: ['acme.com'] });

    reply(200, {});
    await removeSamlProvider('prov-1');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('explains what went wrong', async () => {
    reply(404, { message: 'SAML 2.0 is disabled' });
    await expect(registerSamlProvider({ metadataUrl: 'https://x', domains: ['acme.com'] })).rejects.toMatchObject({ code: 'saml_not_enabled' });
    reply(400, { message: 'SAML Metadata URL returned invalid XML' });
    await expect(registerSamlProvider({ metadataUrl: 'https://x', domains: ['acme.com'] })).rejects.toMatchObject({ code: 'invalid_metadata' });
    reply(422, { message: 'Domain already exists for another provider' });
    await expect(registerSamlProvider({ metadataUrl: 'https://x', domains: ['acme.com'] })).rejects.toMatchObject({ code: 'domain_taken' });
    delete process.env.SUPABASE_MANAGEMENT_TOKEN;
    await expect(registerSamlProvider({ metadataUrl: 'https://x', domains: ['acme.com'] })).rejects.toBeInstanceOf(SsoSetupError);
  });
});

describe('joining the team after SSO sign-in', () => {
  it('reads the provider from the SSO identity', () => {
    expect(ssoProviderIdOf({ app_metadata: {}, identities: [{ provider: 'sso:prov-1' }] } as never)).toBe('prov-1');
    expect(ssoProviderIdOf({ app_metadata: { provider: 'sso:prov-2' }, identities: [] } as never)).toBe('prov-2');
    expect(ssoProviderIdOf({ app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }] } as never)).toBeNull();
  });

  it('adds the user to the team that owns the provider', async () => {
    const upserts: unknown[] = [];
    const filters: Array<[string, unknown]> = [];
    createAdminClient.mockReturnValue({
      from: (table: string) => ({
        select: () => {
          const builder = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value]);
              return builder;
            },
            maybeSingle: async () => ({ data: table === 'organizations' ? { id: 'org-1' } : null }),
          };
          return builder;
        },
        upsert: async (row: unknown) => {
          upserts.push(row);
          return { error: null };
        },
      }),
    });
    const orgId = await joinSsoOrganization({ id: 'user-1', app_metadata: {}, identities: [{ provider: 'sso:prov-1' }] } as never);
    expect(orgId).toBe('org-1');
    expect(filters).toEqual([
      ['sso_enabled', true],
      ['sso_config->>provider_id', 'prov-1'],
    ]);
    expect(upserts[0]).toMatchObject({ organization_id: 'org-1', user_id: 'user-1', role: 'member', status: 'active' });
  });

  it('does nothing for password accounts', async () => {
    expect(await joinSsoOrganization({ id: 'user-1', app_metadata: {}, identities: [{ provider: 'email' }] } as never)).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
