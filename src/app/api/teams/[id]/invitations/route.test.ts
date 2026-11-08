import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/organizations', () => ({
  ...jest.requireActual('@/lib/organizations'),
  getServerOrganizationClient: jest.fn(),
  getMemberRole: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/rateLimit', () => ({ rateLimit: jest.fn(async () => ({ ok: true })) }));
jest.mock('@/lib/teamInvites', () => ({
  deliverInvitation: jest.fn(async () => ({ emailSent: false })),
  invitePath: (token: string) => `/teams/join?token=${token}`,
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}));

const { getServerOrganizationClient, getMemberRole } = jest.requireMock('@/lib/organizations') as {
  getServerOrganizationClient: jest.Mock;
  getMemberRole: jest.Mock;
};
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { deliverInvitation } = jest.requireMock('@/lib/teamInvites') as { deliverInvitation: jest.Mock };

type Row = Record<string, unknown>;
type Call = { table: string; op: 'select' | 'insert' | 'update'; filters: Array<[string, unknown]>; patch?: Row };

/** A small Supabase stand-in over in-memory tables: select, insert and update, with eq filters. */
function fakeClient(tables: Record<string, Row[]>, user: { id: string } | null = null) {
  const calls: Call[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      const run = () => {
        calls.push(call);
        const rows = (tables[table] ??= []);
        if (call.op === 'insert') {
          const row = { id: `new-${rows.length + 1}`, ...call.patch };
          rows.push(row);
          return [{ ...row }];
        }
        const hit = rows.filter((row) => call.filters.every(([column, value]) => row[column] === value));
        if (call.op === 'update') hit.forEach((row) => Object.assign(row, call.patch));
        return hit.map((row) => ({ ...row }));
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        gte: () => builder,
        insert: (row: Row) => {
          call.op = 'insert';
          call.patch = row;
          return builder;
        },
        update: (patch: Row) => {
          call.op = 'update';
          call.patch = patch;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return builder;
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => {
          const [row] = run();
          return row ? { data: row, error: null } : { data: null, error: { message: 'No rows' } };
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client, calls };
}

const TEAM = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_TEAM = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e';
const ME = 'user-admin';
const INV = {
  admin: '66666666-6666-4666-8666-666666666661',
  member: '66666666-6666-4666-8666-666666666662',
  elsewhere: '66666666-6666-4666-8666-666666666663',
};

function invitationRows(): Row[] {
  const pending = { status: 'pending', invited_by: 'user-owner', expires_at: '2026-11-15T00:00:00Z', created_at: '2026-11-08T00:00:00Z' };
  return [
    { id: INV.admin, organization_id: TEAM, email: 'lee@acme.dev', role: 'admin', token: 'token-admin', ...pending },
    { id: INV.member, organization_id: TEAM, email: 'sam@acme.dev', role: 'member', token: 'token-member', ...pending },
    { id: INV.elsewhere, organization_id: OTHER_TEAM, email: 'kim@else.dev', role: 'member', token: 'token-else', ...pending },
  ];
}

let tables: Record<string, Row[]>;
let user: ReturnType<typeof fakeClient>;

/** Signs in as `userId`, whose role in the team is `role`; invitations are written with their own client. */
function signedInAs(userId: string | null, role: string | null = 'admin') {
  user = fakeClient(tables, userId ? { id: userId } : null);
  getServerOrganizationClient.mockResolvedValue(user.client);
  getMemberRole.mockResolvedValue(userId ? role : null);
}

async function post(body: unknown) {
  const route = await import('./route');
  const request = { json: async () => body } as unknown as NextRequest;
  const res = (await route.POST(request, { params: Promise.resolve({ id: TEAM }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

async function cancel(invitationId: string | null) {
  const route = await import('./route');
  const query = invitationId === null ? '' : `?invitation_id=${invitationId}`;
  const request = { url: `http://localhost/api/teams/${TEAM}/invitations${query}` } as unknown as NextRequest;
  const res = (await route.DELETE(request, { params: Promise.resolve({ id: TEAM }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

const invitation = (email: string) => tables.organization_invitations.find((row) => row.email === email);
const writes = () => user.calls.filter((call) => call.op !== 'select');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  tables = { organization_invitations: invitationRows() };
  createAdminClient.mockReturnValue(
    fakeClient({ organizations: [{ id: TEAM, name: 'Acme engineering' }], profiles: [], organization_members: [] }).client,
  );
  signedInAs(ME);
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/teams/[id]/invitations', () => {
  it('lets an admin invite a member or a viewer, as themselves', async () => {
    expect((await post({ email: 'Jo@Acme.dev', role: 'viewer' })).status).toBe(201);
    expect(invitation('jo@acme.dev')).toMatchObject({ organization_id: TEAM, role: 'viewer', status: 'pending', invited_by: ME });
    expect(deliverInvitation).toHaveBeenCalledWith(expect.objectContaining({ email: 'jo@acme.dev', role: 'viewer' }), 'Acme engineering');
  });

  it('renews a member’s invitation with a fresh link', async () => {
    expect((await post({ email: 'sam@acme.dev', role: 'viewer' })).status).toBe(201);
    expect(invitation('sam@acme.dev')).toMatchObject({ role: 'viewer', status: 'pending', invited_by: ME });
    expect(invitation('sam@acme.dev')?.token).not.toBe('token-member');
  });

  it('only lets the owner invite someone as admin', async () => {
    expect(await post({ email: 'jo@acme.dev', role: 'admin' })).toEqual({ status: 403, body: { error: 'owner_only' } });
    expect(invitation('jo@acme.dev')).toBeUndefined();
    expect(writes()).toEqual([]);
    expect(deliverInvitation).not.toHaveBeenCalled();

    signedInAs('user-owner', 'owner');
    expect((await post({ email: 'jo@acme.dev', role: 'admin' })).status).toBe(201);
    expect(invitation('jo@acme.dev')).toMatchObject({ role: 'admin', invited_by: 'user-owner' });
  });

  it('leaves an invitation as admin to the owner: an admin can’t renew or change it', async () => {
    expect(await post({ email: 'lee@acme.dev', role: 'member' })).toEqual({ status: 403, body: { error: 'admin_invitation' } });
    expect(invitation('lee@acme.dev')).toMatchObject({ role: 'admin', token: 'token-admin' });
    expect(writes()).toEqual([]);

    signedInAs('user-owner', 'owner');
    expect((await post({ email: 'lee@acme.dev', role: 'member' })).status).toBe(201);
    expect(invitation('lee@acme.dev')).toMatchObject({ role: 'member', status: 'pending', invited_by: 'user-owner' });
    expect(invitation('lee@acme.dev')?.token).not.toBe('token-admin');
  });

  it('refuses members, viewers and signed-out visitors', async () => {
    for (const role of ['member', 'viewer', null]) {
      signedInAs('user-member', role);
      expect((await post({ email: 'jo@acme.dev', role: 'viewer' })).status).toBe(403);
    }
    signedInAs(null);
    expect((await post({ email: 'jo@acme.dev', role: 'viewer' })).status).toBe(401);
    expect(tables.organization_invitations).toHaveLength(3);
  });
});

describe('DELETE /api/teams/[id]/invitations', () => {
  it('lets an admin cancel a member’s invitation', async () => {
    expect(await cancel(INV.member)).toEqual({ status: 200, body: { success: true } });
    expect(invitation('sam@acme.dev')?.status).toBe('cancelled');
  });

  it('leaves an invitation as admin to the owner', async () => {
    expect(await cancel(INV.admin)).toEqual({ status: 403, body: { error: 'owner_only' } });
    expect(invitation('lee@acme.dev')?.status).toBe('pending');
    expect(writes()).toEqual([]);

    signedInAs('user-owner', 'owner');
    expect(await cancel(INV.admin)).toEqual({ status: 200, body: { success: true } });
    expect(invitation('lee@acme.dev')?.status).toBe('cancelled');
  });

  it('answers 404 for another team’s invitation, 400 without a valid id, and 403 to members', async () => {
    expect(await cancel(INV.elsewhere)).toEqual({ status: 404, body: { error: 'not_found' } });
    expect((await cancel(null)).status).toBe(400);
    expect((await cancel('not-a-uuid')).status).toBe(400);
    signedInAs('user-member', 'member');
    expect((await cancel(INV.member)).status).toBe(403);
    expect(invitation('kim@else.dev')?.status).toBe('pending');
    expect(invitation('sam@acme.dev')?.status).toBe('pending');
  });
});
