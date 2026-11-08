jest.mock('@/i18n/routing', () => ({ redirect: jest.fn(() => 'redirected') }));
jest.mock('next-intl/server', () => ({
  getLocale: async () => 'fr',
  getTranslations: async () => (key: string) => key,
}));
jest.mock('@/components/AppShell', () => ({ AppShell: ({ children }: { children: unknown }) => children }));
jest.mock('./TeamsClient', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/organizations', () => ({
  getServerOrganizationClient: jest.fn(),
  getUserOrganizationContext: jest.fn(async () => ({ organization: null, role: null })),
}));

import TeamsPage from './page';

const { redirect } = jest.requireMock('@/i18n/routing') as { redirect: jest.Mock };
const { getServerOrganizationClient } = jest.requireMock('@/lib/organizations') as { getServerOrganizationClient: jest.Mock };

beforeEach(() => jest.clearAllMocks());

describe('/teams', () => {
  it('sends a signed-out visitor to sign in, and back to Teams afterwards, in their language', async () => {
    getServerOrganizationClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
    await TeamsPage();
    expect(redirect).toHaveBeenCalledWith({ href: '/auth?next=/teams', locale: 'fr' });
  });

  it('shows the page to a signed-in user', async () => {
    getServerOrganizationClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } });
    await TeamsPage();
    expect(redirect).not.toHaveBeenCalledWith(expect.objectContaining({ href: expect.stringContaining('/auth') }));
  });
});
