import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/organizations', () => ({
  ...jest.requireActual('@/lib/organizations'),
  getServerOrganizationClient: jest.fn(),
  checkOrganizationAccess: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const { getServerOrganizationClient, checkOrganizationAccess } = jest.requireMock('@/lib/organizations') as {
  getServerOrganizationClient: jest.Mock;
  checkOrganizationAccess: jest.Mock;
};
const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };

type Row = Record<string, unknown>;
type Filter = { kind: 'eq' | 'neq' | 'in'; column: string; value: unknown };
type Call = { table: string; op: 'select' | 'update' | 'delete'; filters: Filter[]; patch?: Row };

/** A small Supabase stand-in over in-memory tables: select, update, delete, with eq / neq / in filters. */
function fakeClient(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      const matches = () =>
        (tables[table] ?? []).filter((row) =>
          call.filters.every(({ kind, column, value }) =>
            kind === 'eq' ? row[column] === value : kind === 'neq' ? row[column] !== value : (value as unknown[]).includes(row[column]),
          ),
        );
      const run = () => {
        calls.push(call);
        const hit = matches();
        if (call.op === 'update') hit.forEach((row) => Object.assign(row, call.patch));
        if (call.op === 'delete') tables[table] = (tables[table] ?? []).filter((row) => !hit.includes(row));
        return { data: hit.map((row) => ({ ...row })), error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        update: (patch: Row) => {
          call.op = 'update';
          call.patch = patch;
          return builder;
        },
        delete: () => {
          call.op = 'delete';
          return builder;
        },
        eq: (column: string, value: unknown) => (call.filters.push({ kind: 'eq', column, value }), builder),
        neq: (column: string, value: unknown) => (call.filters.push({ kind: 'neq', column, value }), builder),
        in: (column: string, value: unknown[]) => (call.filters.push({ kind: 'in', column, value }), builder),
        maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return builder;
    },
  };
  return { client, calls, tables };
}

const TEAM = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_TEAM = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4e';
const ME = 'user-admin';
const IDS = {
  owner: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  member: '33333333-3333-4333-8333-333333333333',
  elsewhere: '44444444-4444-4444-8444-444444444444',
};

function teamRows(): Row[] {
  return [
    { id: IDS.owner, organization_id: TEAM, user_id: 'user-owner', role: 'owner', status: 'active', created_at: '2026-09-01T00:00:00Z' },
    { id: IDS.admin, organization_id: TEAM, user_id: ME, role: 'admin', status: 'active', created_at: '2026-09-02T00:00:00Z' },
    { id: IDS.member, organization_id: TEAM, user_id: 'user-member', role: 'member', status: 'active', created_at: '2026-09-03T00:00:00Z' },
    { id: IDS.elsewhere, organization_id: OTHER_TEAM, user_id: 'user-other', role: 'member', status: 'active', created_at: '2026-09-04T00:00:00Z' },
  ];
}

let admin: ReturnType<typeof fakeClient>;

function signedInAs(userId: string | null) {
  getServerOrganizationClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
  });
}

async function patch(body: unknown) {
  const route = await import('./route');
  const request = { json: async () => body } as unknown as NextRequest;
  const res = (await route.PATCH(request, { params: Promise.resolve({ id: TEAM }) })) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

const memberRow = (id: string) => admin.tables.organization_members.find((row) => row.id === id);
const writes = () => admin.calls.filter((call) => call.op !== 'select');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  admin = fakeClient({ organization_members: teamRows() });
  createAdminClient.mockReturnValue(admin.client);
  checkOrganizationAccess.mockResolvedValue(true);
  signedInAs(ME);
});

afterEach(() => jest.restoreAllMocks());

describe('PATCH /api/teams/[id]/members', () => {
  it('lets an admin remove a member, writing with the service role', async () => {
    expect(await patch({ action: 'remove', member_id: IDS.member })).toEqual({ status: 200, body: { success: true } });
    expect(checkOrganizationAccess).toHaveBeenCalledWith(expect.anything(), TEAM, ['owner', 'admin']);
    expect(memberRow(IDS.member)).toBeUndefined();
    // Scoped to this team, and never an owner row.
    expect(writes()).toEqual([
      expect.objectContaining({
        op: 'delete',
        filters: expect.arrayContaining([
          { kind: 'eq', column: 'organization_id', value: TEAM },
          { kind: 'neq', column: 'role', value: 'owner' },
        ]),
      }),
    ]);
  });

  it('lets an admin change a member’s role', async () => {
    expect(await patch({ action: 'update_role', member_id: IDS.member, role: 'viewer' })).toEqual({ status: 200, body: { success: true } });
    expect(memberRow(IDS.member)?.role).toBe('viewer');
  });

  it('never changes or removes an owner', async () => {
    expect(await patch({ action: 'remove', member_id: IDS.owner })).toEqual({ status: 403, body: { error: 'owner_protected' } });
    expect(await patch({ action: 'update_role', member_id: IDS.owner, role: 'member' })).toEqual({ status: 403, body: { error: 'owner_protected' } });
    expect(memberRow(IDS.owner)?.role).toBe('owner');
    expect(writes()).toEqual([]);
  });

  it('does not let an admin make anyone an owner (nor anyone else, through this form)', async () => {
    expect(await patch({ action: 'update_role', member_id: IDS.member, role: 'owner' })).toEqual({ status: 403, body: { error: 'cannot_make_owner' } });
    signedInAs('user-owner');
    expect(await patch({ action: 'update_role', member_id: IDS.member, role: 'owner' })).toEqual({ status: 403, body: { error: 'cannot_make_owner' } });
    expect(memberRow(IDS.member)?.role).toBe('member');
    expect(writes()).toEqual([]);
  });

  it('does not let you change your own role', async () => {
    expect(await patch({ action: 'update_role', member_id: IDS.admin, role: 'viewer' })).toEqual({ status: 403, body: { error: 'own_role' } });
    expect(memberRow(IDS.admin)?.role).toBe('admin');
    expect(writes()).toEqual([]);
  });

  it('answers 404 for a member of another team, and changes nothing there', async () => {
    expect(await patch({ action: 'remove', member_id: IDS.elsewhere })).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(await patch({ action: 'update_role', member_id: IDS.elsewhere, role: 'admin' })).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(memberRow(IDS.elsewhere)).toMatchObject({ role: 'member' });
    expect(writes()).toEqual([]);
  });

  it('answers 409 when the write changed nothing (the member changed in the meantime)', async () => {
    // Found by the check, then promoted to owner before the write: the owner guard leaves it alone.
    const tables = admin.tables;
    const original = admin.client.from.bind(admin.client);
    let reads = 0;
    createAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'organization_members' && reads++ === 1) {
          const row = tables.organization_members.find((r) => r.id === IDS.member);
          if (row) row.role = 'owner';
        }
        return original(table);
      },
    });
    expect(await patch({ action: 'update_role', member_id: IDS.member, role: 'viewer' })).toEqual({ status: 409, body: { error: 'conflict' } });
    expect(memberRow(IDS.member)?.role).toBe('owner');
  });

  it('refuses people who are not owners or admins, signed-out visitors and malformed requests', async () => {
    checkOrganizationAccess.mockResolvedValue(false);
    expect((await patch({ action: 'remove', member_id: IDS.member })).status).toBe(403);
    checkOrganizationAccess.mockResolvedValue(true);
    signedInAs(null);
    expect((await patch({ action: 'remove', member_id: IDS.member })).status).toBe(401);
    signedInAs(ME);
    expect(await patch({ action: 'remove', member_id: 'not-a-uuid' })).toEqual({ status: 400, body: { error: 'invalid_body' } });
    expect(await patch({ action: 'update_role', member_id: IDS.member, role: 'boss' })).toEqual({ status: 400, body: { error: 'invalid_body' } });
    expect(await patch({ action: 'promote', member_id: IDS.member })).toEqual({ status: 400, body: { error: 'invalid_body' } });
    expect(memberRow(IDS.member)).toMatchObject({ role: 'member' });
  });
});

describe('GET /api/teams/[id]/members', () => {
  it('names every teammate: profiles are read with the service role, only for this team’s members', async () => {
    const user = fakeClient({ organization_members: teamRows().filter((row) => row.organization_id === TEAM) });
    getServerOrganizationClient.mockResolvedValue({ ...user.client, auth: { getUser: async () => ({ data: { user: { id: ME } } }) } });
    admin = fakeClient({
      profiles: [
        { id: 'user-owner', email: 'ana@acme.dev', full_name: 'Ana Ruiz', avatar_url: 'https://cdn.example/ana.png' },
        { id: ME, email: 'me@acme.dev', full_name: null, avatar_url: null },
        { id: 'user-member', email: 'marcus@acme.dev', full_name: 'Marcus Webb', avatar_url: null },
        { id: 'user-other', email: 'other@else.dev', full_name: 'Someone Else', avatar_url: null },
      ],
    });
    createAdminClient.mockReturnValue(admin.client);

    const route = await import('./route');
    const res = (await route.GET({} as NextRequest, { params: Promise.resolve({ id: TEAM }) })) as unknown as {
      status: number;
      json: () => Promise<{ members: Array<Record<string, unknown>> }>;
    };
    expect(res.status).toBe(200);
    const { members } = await res.json();
    expect(members.map((m) => [m.user_full_name, m.user_email, m.user_avatar_url])).toEqual([
      ['Ana Ruiz', 'ana@acme.dev', 'https://cdn.example/ana.png'],
      [null, 'me@acme.dev', null],
      ['Marcus Webb', 'marcus@acme.dev', null],
    ]);
    expect(admin.calls).toEqual([
      { table: 'profiles', op: 'select', filters: [{ kind: 'in', column: 'id', value: ['user-owner', ME, 'user-member'] }] },
    ]);
  });

  it('reads nothing for someone outside the team', async () => {
    checkOrganizationAccess.mockResolvedValue(false);
    const route = await import('./route');
    const res = (await route.GET({} as NextRequest, { params: Promise.resolve({ id: TEAM }) })) as unknown as { status: number };
    expect(res.status).toBe(403);
    expect(admin.calls).toEqual([]);
  });
});
