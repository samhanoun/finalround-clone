/** @jest-environment node */
import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }),
  },
}));
jest.mock('@/lib/adminAuth', () => ({
  requireAdmin: jest.fn(async () => ({ ok: true, userId: 'staff-1', role: 'support_agent' })),
}));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/support', () => ({ replyAsAdmin: jest.fn(async () => true) }));

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { replyAsAdmin } = jest.requireMock('@/lib/support') as { replyAsAdmin: jest.Mock };

const TICKET_ID = '33333333-3333-4333-8333-333333333333';

/** support_tickets updates: the values written, and whether the ticket exists. */
function fakeAdmin(exists = true, error: { message: string } | null = null) {
  const updates: Array<Record<string, unknown>> = [];
  createAdminClient.mockReturnValue({
    from: () => {
      const query = {
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return query;
        },
        eq: () => query,
        select: async () => ({ data: exists ? [{ id: TICKET_ID }] : [], error }),
      };
      return query;
    },
  });
  return updates;
}

async function patch(body: unknown) {
  const { PATCH } = await import('./route');
  const res = (await PATCH({ json: async () => body } as unknown as NextRequest)) as unknown as { status: number; json: () => Promise<Record<string, unknown>> };
  return { status: res.status, body: await res.json() };
}

beforeEach(() => jest.clearAllMocks());

describe('PATCH /api/admin/tickets', () => {
  it('changes the status sent under data, stamping a resolution', async () => {
    const updates = fakeAdmin();
    expect(await patch({ action: 'update_status', ticket_id: TICKET_ID, data: { status: 'in_progress' } })).toEqual({ status: 200, body: { success: true } });
    expect(updates[0]).toEqual({ status: 'in_progress' });
    await patch({ action: 'update_status', ticket_id: TICKET_ID, data: { status: 'resolved' } });
    expect(updates[1]).toEqual({ status: 'resolved', resolved_at: expect.any(String) });
  });

  it('refuses a status that doesn’t exist, or none', async () => {
    const updates = fakeAdmin();
    expect((await patch({ action: 'update_status', ticket_id: TICKET_ID, data: { status: 'deleted' } })).status).toBe(400);
    expect((await patch({ action: 'update_status', ticket_id: TICKET_ID })).status).toBe(400);
    expect(updates).toEqual([]);
  });

  it('reports a ticket that isn’t there, and a database error', async () => {
    fakeAdmin(false);
    expect(await patch({ action: 'update_status', ticket_id: TICKET_ID, data: { status: 'resolved' } })).toEqual({ status: 404, body: { error: 'not_found' } });

    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeAdmin(true, { message: 'permission denied' });
    expect(await patch({ action: 'update_priority', ticket_id: TICKET_ID, data: { priority: 'high' } })).toEqual({ status: 500, body: { error: 'action_failed' } });
    error.mockRestore();
  });

  it('replies as the signed-in staff member', async () => {
    fakeAdmin();
    expect((await patch({ action: 'reply', ticket_id: TICKET_ID, data: { content: '  Refunded  ' } })).status).toBe(200);
    expect(replyAsAdmin).toHaveBeenCalledWith('staff-1', TICKET_ID, 'Refunded');
    expect((await patch({ action: 'reply', ticket_id: TICKET_ID, data: { content: ' ' } })).body.error).toBe('empty_reply');
    replyAsAdmin.mockResolvedValueOnce(false);
    expect((await patch({ action: 'reply', ticket_id: TICKET_ID, data: { content: 'Hi' } })).status).toBe(404);
  });
});
