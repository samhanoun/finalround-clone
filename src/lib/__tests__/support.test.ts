jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/notify', () => ({ notify: jest.fn() }));

import { createTicket, replyAsAdmin, replyAsUser } from '@/lib/support';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { notify } = jest.requireMock('@/lib/notify') as { notify: jest.Mock };

type Row = Record<string, unknown>;

function mockAdmin(tables: Record<string, Row | Row[] | null>) {
  const writes: Array<{ table: string; op: string; row: Row }> = [];
  createAdminClient.mockReturnValue({
    from: (table: string) => {
      const value = tables[table];
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.maybeSingle = async () => ({ data: Array.isArray(value) ? value[0] ?? null : value ?? null });
      builder.single = async () => ({ data: { id: 'ticket-1', ...(writes[writes.length - 1]?.row ?? {}) }, error: null });
      builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: Array.isArray(value) ? value : value ? [value] : [] }).then(resolve);
      builder.insert = (row: Row) => {
        writes.push({ table, op: 'insert', row });
        const chain = { select: () => chain, single: builder.single, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
        return chain;
      };
      builder.update = (row: Row) => {
        writes.push({ table, op: 'update', row });
        return { eq: async () => ({ error: null }) };
      };
      return builder;
    },
  });
  return writes;
}

beforeEach(() => jest.clearAllMocks());

describe('support tickets', () => {
  it('opens a ticket the server fills in, and tells the support team', async () => {
    const writes = mockAdmin({ profiles: { full_name: 'Sam Lee' }, admin_users: [{ user_id: 'admin-1' }] });
    const ticket = await createTicket({ id: 'user-1', email: 'sam@example.com' }, { subject: 'Audio cuts out', description: 'It stops after a minute.', category: 'technical' });
    expect(ticket.id).toBe('ticket-1');
    expect(writes[0]).toEqual({
      table: 'support_tickets',
      op: 'insert',
      row: {
        user_id: 'user-1',
        email: 'sam@example.com',
        full_name: 'Sam Lee',
        subject: 'Audio cuts out',
        description: 'It stops after a minute.',
        category: 'technical',
        priority: 'medium',
        status: 'open',
      },
    });
    expect(notify).toHaveBeenCalledWith('admin-1', expect.objectContaining({ type: 'system', url: '/admin' }));
  });

  it('only lets the owner reply, and reopens the ticket', async () => {
    let writes = mockAdmin({ support_tickets: { id: 't1', user_id: 'someone-else', status: 'resolved' } });
    expect(await replyAsUser('user-1', 't1', 'Still broken')).toBe(false);
    expect(writes).toEqual([]);

    writes = mockAdmin({ support_tickets: { id: 't1', user_id: 'user-1', status: 'resolved' } });
    expect(await replyAsUser('user-1', 't1', 'Still broken')).toBe(true);
    expect(writes[0]).toMatchObject({ table: 'support_messages', row: { ticket_id: 't1', user_id: 'user-1', is_from_admin: false } });
    expect(writes[1]).toMatchObject({ table: 'support_tickets', row: { status: 'open', resolved_at: null } });
  });

  it('records a support reply under the admin and emails the user', async () => {
    const writes = mockAdmin({ support_tickets: { id: 't1', user_id: 'user-1', subject: 'Audio cuts out' } });
    expect(await replyAsAdmin('admin-1', 't1', 'Fixed in the latest version.')).toBe(true);
    expect(writes[0]).toMatchObject({ table: 'support_messages', row: { user_id: 'admin-1', is_from_admin: true } });
    expect(writes[1]).toMatchObject({ row: { status: 'waiting_user' } });
    expect(notify).toHaveBeenCalledWith('user-1', expect.objectContaining({ emailAlways: true, url: '/support' }));
  });
});
