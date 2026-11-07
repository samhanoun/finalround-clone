import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/organizations', () => ({
  getServerOrganizationClient: jest.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) } })),
  getOrganization: jest.fn(),
  checkOrganizationAccess: jest.fn(async () => true),
}));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/sso', () => ({
  ...jest.requireActual('@/lib/sso'),
  removeSamlProvider: jest.fn(async () => undefined),
}));

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { checkOrganizationAccess } = jest.requireMock('@/lib/organizations') as { checkOrganizationAccess: jest.Mock };
const { removeSamlProvider } = jest.requireMock('@/lib/sso') as { removeSamlProvider: jest.Mock };

const TEAM = 'team-1';

function mockTeam(org: { id: string; sso_config: Record<string, unknown> | null } | null) {
  const deletes: string[] = [];
  createAdminClient.mockReturnValue({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: org, error: null });
      builder.delete = () => ({
        eq: (_column: string, id: string) => ({
          select: async () => {
            deletes.push(id);
            return { data: org ? [{ id }] : [], error: null };
          },
        }),
      });
      return builder;
    },
  });
  return deletes;
}

async function del() {
  const route = await import('./route');
  const res = (await route.DELETE({} as NextRequest, { params: Promise.resolve({ id: TEAM }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  jest.clearAllMocks();
  checkOrganizationAccess.mockResolvedValue(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('DELETE /api/teams/[id]', () => {
  it('lets only the owner delete the team', async () => {
    checkOrganizationAccess.mockResolvedValue(false);
    const deletes = mockTeam({ id: TEAM, sso_config: {} });
    expect((await del()).status).toBe(403);
    expect(checkOrganizationAccess).toHaveBeenCalledWith(expect.anything(), TEAM, ['owner']);
    expect(deletes).toEqual([]);
  });

  it('deletes the team with the service role, since users have no delete policy', async () => {
    const deletes = mockTeam({ id: TEAM, sso_config: {} });
    expect(await del()).toEqual({ status: 200, body: { success: true } });
    expect(deletes).toEqual([TEAM]);
    expect(removeSamlProvider).not.toHaveBeenCalled();
  });

  it('removes the team identity provider first, and keeps the team if that fails', async () => {
    let deletes = mockTeam({ id: TEAM, sso_config: { provider_id: 'prov-1' } });
    expect((await del()).status).toBe(200);
    expect(removeSamlProvider).toHaveBeenCalledWith('prov-1');
    expect(deletes).toEqual([TEAM]);

    removeSamlProvider.mockRejectedValueOnce(new Error('management API down'));
    deletes = mockTeam({ id: TEAM, sso_config: { provider_id: 'prov-1' } });
    expect(await del()).toMatchObject({ status: 502, body: { error: 'sso_failed' } });
    expect(deletes).toEqual([]);
  });

  it('says so when the team no longer exists', async () => {
    mockTeam(null);
    expect((await del()).status).toBe(404);
  });
});
