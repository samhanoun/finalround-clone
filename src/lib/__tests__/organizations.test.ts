import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrganizationMembers, getTeamStats, type Organization, type OrganizationMember, type OrganizationRole } from '../organizations';

describe('organizations', () => {
  describe('Organization types', () => {
    it('should have correct Organization shape', () => {
      const org: Organization = {
        id: '123',
        name: 'Test Org',
        slug: 'test-org',
        logo_url: null,
        plan: 'team',
        sso_enabled: false,
        sso_provider: null,
        sso_config: {},
        settings: {},
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      expect(org.plan).toBe('team');
    });

    it('should have valid role types', () => {
      const validRoles: OrganizationRole[] = ['owner', 'admin', 'member', 'viewer'];
      expect(validRoles).toContain('owner');
      expect(validRoles).toContain('admin');
      expect(validRoles).toContain('member');
      expect(validRoles).toContain('viewer');
    });

    it('should have valid plan types', () => {
      const plans = ['free', 'team', 'enterprise'] as const;
      expect(plans).toContain('free');
      expect(plans).toContain('team');
      expect(plans).toContain('enterprise');
    });
  });

  describe('Team stats calculation', () => {
    it('should calculate total members correctly', () => {
      const members = [
        { status: 'active' },
        { status: 'active' },
        { status: 'pending' },
      ];
      const totalMembers = members.length;
      const activeMembers = members.filter(m => m.status === 'active').length;
      
      expect(totalMembers).toBe(3);
      expect(activeMembers).toBe(2);
    });

    it('should handle empty members array', () => {
      const members: { status: string }[] = [];
      const totalMembers = members.length;
      
      expect(totalMembers).toBe(0);
    });
  });

  describe('Invitation handling', () => {
    it('should validate invitation expiration', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      
      expect(futureDate > new Date()).toBe(true);
      expect(pastDate < new Date()).toBe(true);
    });

    it('should have valid invitation statuses', () => {
      const statuses = ['pending', 'accepted', 'expired', 'cancelled'];
      expect(statuses).toContain('pending');
      expect(statuses).toContain('accepted');
      expect(statuses).not.toContain('invalid');
    });
  });
});

type Row = Record<string, unknown>;

/** Records every query (table, filters, count) and answers from in-memory rows. */
function recordingClient(tables: Record<string, Row[]>) {
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]>; head: boolean }> = [];
  const client = {
    from(table: string) {
      const query = { table, filters: [] as Array<[string, string, unknown]>, head: false };
      const rows = () =>
        (tables[table] ?? []).filter((row) =>
          query.filters.every(([op, column, value]) =>
            op === 'eq'
              ? row[column] === value
              : op === 'in'
                ? (value as unknown[]).includes(row[column])
                : op === 'gte'
                  ? String(row[column]) >= String(value)
                  : true,
          ),
        );
      const builder: Record<string, unknown> = {
        select: (_columns: string, options?: { head?: boolean }) => ((query.head = Boolean(options?.head)), builder),
        order: () => builder,
        eq: (column: string, value: unknown) => (query.filters.push(['eq', column, value]), builder),
        in: (column: string, value: unknown[]) => (query.filters.push(['in', column, value]), builder),
        gte: (column: string, value: unknown) => (query.filters.push(['gte', column, value]), builder),
        then: (resolve: (value: unknown) => unknown) => {
          queries.push(query);
          const found = rows();
          return Promise.resolve({ data: query.head ? null : found, count: found.length, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

describe('team members and stats read teammates’ private rows only after the access check', () => {
  const TEAM = 'team-1';
  const members = [
    { id: 'm1', organization_id: TEAM, user_id: 'ana', role: 'owner', status: 'active' },
    { id: 'm2', organization_id: TEAM, user_id: 'marcus', role: 'member', status: 'active' },
    { id: 'm3', organization_id: TEAM, user_id: 'sam', role: 'viewer', status: 'invited' },
  ];

  it('names each member from their profile, read with the service role for this team only', async () => {
    const user = recordingClient({ organization_members: members });
    const service = recordingClient({
      profiles: [
        { id: 'ana', email: 'ana@acme.dev', full_name: 'Ana Ruiz', avatar_url: 'https://cdn.example/ana.png' },
        { id: 'marcus', email: 'marcus@acme.dev', full_name: null, avatar_url: null },
        { id: 'stranger', email: 'x@else.dev', full_name: 'Stranger', avatar_url: null },
      ],
    });
    const list = await getOrganizationMembers(user.client as never, TEAM, service.client);
    expect(list.map((m: OrganizationMember) => [m.id, m.user_full_name, m.user_email, m.user_avatar_url])).toEqual([
      ['m1', 'Ana Ruiz', 'ana@acme.dev', 'https://cdn.example/ana.png'],
      ['m2', null, 'marcus@acme.dev', null],
      // No profile row (yet): no name rather than someone else's.
      ['m3', null, null, null],
    ]);
    expect(service.queries).toEqual([{ table: 'profiles', filters: [['in', 'id', ['ana', 'marcus', 'sam']]], head: false }]);
  });

  it('counts the members’ practice interviews and live sessions, all time and this month (UTC)', async () => {
    const now = new Date('2026-11-07T12:00:00Z');
    const user = recordingClient({
      organization_members: members,
      organization_invitations: [
        { organization_id: TEAM, status: 'pending', expires_at: '2026-11-10T00:00:00Z' },
        { organization_id: TEAM, status: 'pending', expires_at: '2026-11-01T00:00:00Z' },
      ],
    });
    const service = recordingClient({
      interview_sessions: [
        { user_id: 'ana', created_at: '2026-10-30T10:00:00Z' },
        { user_id: 'ana', created_at: '2026-11-02T10:00:00Z' },
        { user_id: 'marcus', created_at: '2026-11-05T10:00:00Z' },
        { user_id: 'stranger', created_at: '2026-11-05T10:00:00Z' },
      ],
      copilot_sessions: [
        { user_id: 'marcus', started_at: '2026-10-15T10:00:00Z' },
        { user_id: 'sam', started_at: '2026-11-06T10:00:00Z' },
        { user_id: 'stranger', started_at: '2026-11-06T10:00:00Z' },
      ],
    });
    expect(await getTeamStats(user.client as never, TEAM, service.client, now)).toEqual({
      totalMembers: 3,
      activeMembers: 2,
      pendingInvitations: 1,
      practiceInterviews: { total: 3, thisMonth: 2 },
      liveSessions: { total: 2, thisMonth: 1 },
    });
    // The legacy `interviews` table is gone from the count, and every session count is limited to the members.
    expect(service.queries.map((q) => q.table).sort()).toEqual(['copilot_sessions', 'copilot_sessions', 'interview_sessions', 'interview_sessions']);
    for (const query of service.queries) expect(query.filters).toContainEqual(['in', 'user_id', ['ana', 'marcus', 'sam']]);
    expect(service.queries.filter((q) => q.filters.some(([op]) => op === 'gte')).map((q) => q.filters.find(([op]) => op === 'gte'))).toEqual(
      expect.arrayContaining([
        ['gte', 'created_at', '2026-11-01T00:00:00.000Z'],
        ['gte', 'started_at', '2026-11-01T00:00:00.000Z'],
      ]),
    );
    expect(user.queries.some((q) => q.table === 'interviews')).toBe(false);
  });

  it('reads no sessions for a team without members', async () => {
    const service = recordingClient({});
    const stats = await getTeamStats(recordingClient({}).client as never, TEAM, service.client);
    expect(stats.practiceInterviews).toEqual({ total: 0, thisMonth: 0 });
    expect(service.queries).toEqual([]);
  });
});
