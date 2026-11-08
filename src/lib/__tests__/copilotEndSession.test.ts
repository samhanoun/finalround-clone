jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));
jest.mock('@/lib/quota', () => ({ checkQuota: jest.fn(), recordUsage: jest.fn() }));
jest.mock('@/lib/copilot', () => ({
  ...jest.requireActual('@/lib/copilot'),
  getCopilotQuotaSnapshot: jest.fn(),
  recordCopilotUsage: jest.fn(),
}));
// Work Next runs after the response; the tests run it when they choose.
const mockAfter = jest.fn();
jest.mock('next/server', () => ({ after: (task: () => unknown) => mockAfter(task) }));
jest.mock('@/lib/memoryExtraction', () => ({ rememberFromSession: jest.fn(async () => 0) }));

import { endCopilotSession, endOpenCopilotSessions, type EndableCopilotSession } from '@/lib/copilot/endSession';

const { createAdminClient } = jest.requireMock('@/lib/supabase/admin') as { createAdminClient: jest.Mock };
const { getCopilotQuotaSnapshot, recordCopilotUsage } = jest.requireMock('@/lib/copilot') as {
  getCopilotQuotaSnapshot: jest.Mock;
  recordCopilotUsage: jest.Mock;
};
const { rememberFromSession } = jest.requireMock('@/lib/memoryExtraction') as { rememberFromSession: jest.Mock };

/** Runs what was handed to `after`, as Next does once the response is sent. */
async function runAfterResponse() {
  for (const [task] of mockAfter.mock.calls) await (task as () => Promise<unknown>)();
}

const NOW = new Date('2026-10-23T10:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function session(overrides: Partial<EndableCopilotSession> = {}): EndableCopilotSession {
  return {
    id: 'session-1',
    user_id: 'user-1',
    status: 'active',
    started_at: minutesAgo(20),
    metadata: { last_heartbeat_at: minutesAgo(0.5) },
    ...overrides,
  };
}

/** The service-role client; `row` is what the guarded update returns (null: someone else ended it). */
function mockAdmin(row: Record<string, unknown> | null = { id: 'session-1' }) {
  const filters: Array<[string, unknown]> = [];
  const update = jest.fn(() => {
    const chain = {
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      select: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
    };
    return chain;
  });
  createAdminClient.mockReturnValue({ from: () => ({ update }) });
  return { update, filters };
}

function quota(remaining: number) {
  const counter = { allowed: remaining > 0, used: 0, limit: 400, remaining };
  getCopilotQuotaSnapshot.mockResolvedValue({ monthly: counter, daily: counter, perSession: counter });
}

beforeEach(() => {
  jest.clearAllMocks();
  quota(400);
});

describe('endCopilotSession', () => {
  it('bills a stopped session up to the stop and charges it once, with the service role', async () => {
    const { update, filters } = mockAdmin();
    const { ended } = await endCopilotSession(session(), { status: 'stopped', endedAt: NOW });

    expect(ended?.billableMinutes).toBe(20);
    expect(recordCopilotUsage).toHaveBeenCalledTimes(1);
    expect(recordCopilotUsage).toHaveBeenCalledWith('user-1', 20);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'stopped', duration_seconds: 1200, consumed_minutes: 20, stopped_at: NOW.toISOString() }),
    );
    // Only an active session is ended, so a second request can't bill it again.
    expect(filters).toEqual([
      ['id', 'session-1'],
      ['user_id', 'user-1'],
      ['status', 'active'],
    ]);
  });

  it('bills an expired session up to its last heartbeat, not to when the expiry was noticed', async () => {
    const { update } = mockAdmin();
    const { ended } = await endCopilotSession(session({ metadata: { last_heartbeat_at: minutesAgo(12) } }), {
      status: 'expired',
      endedAt: NOW,
    });

    expect(ended?.billableMinutes).toBe(8);
    expect(recordCopilotUsage).toHaveBeenCalledWith('user-1', 8);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'expired',
        metadata: expect.objectContaining({ billed_until: minutesAgo(12), requested_minutes: 8 }),
      }),
    );
  });

  it('bills a Stop that arrives after the heartbeat lapsed up to the last heartbeat', async () => {
    mockAdmin();
    const { ended } = await endCopilotSession(session({ metadata: { last_heartbeat_at: minutesAgo(15) } }), {
      status: 'stopped',
      endedAt: NOW,
    });
    expect(ended?.billableMinutes).toBe(5);
  });

  it('caps the charge at what the plan has left', async () => {
    quota(7);
    mockAdmin();
    const { ended } = await endCopilotSession(session(), { status: 'stopped', endedAt: NOW });
    expect(ended?.billableMinutes).toBe(7);
    expect(recordCopilotUsage).toHaveBeenCalledWith('user-1', 7);
  });

  it('charges nothing when another request already ended the session', async () => {
    mockAdmin(null);
    const { ended, error } = await endCopilotSession(session(), { status: 'expired', endedAt: NOW });
    expect(error).toBeNull();
    expect(ended?.session).toBeNull();
    expect(recordCopilotUsage).not.toHaveBeenCalled();
  });
});

describe('learning from an ended session (Goals → Memory)', () => {
  it('learns after the response from a session that expired, not only from Stop', async () => {
    mockAdmin();
    await endCopilotSession(session({ metadata: { last_heartbeat_at: minutesAgo(12), goal_id: 'goal-1' } }), {
      status: 'expired',
      endedAt: NOW,
      metadata: { expired_reason: 'heartbeat_timeout' },
    });

    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(rememberFromSession).not.toHaveBeenCalled();
    await runAfterResponse();
    expect(rememberFromSession).toHaveBeenCalledWith('session-1', 'user-1', 'goal-1');
  });

  it('learns from a stopped session without a goal', async () => {
    mockAdmin();
    await endCopilotSession(session(), { status: 'stopped', endedAt: NOW, metadata: { stop_reason: 'user' } });
    await runAfterResponse();
    expect(rememberFromSession).toHaveBeenCalledWith('session-1', 'user-1', null);
  });

  it('learns from sessions a new session replaced or found abandoned', async () => {
    mockAdmin();
    await endOpenCopilotSessions([session({ id: 'abandoned', metadata: { last_heartbeat_at: minutesAgo(30) } }), session({ id: 'running' })], NOW);
    await runAfterResponse();
    expect(rememberFromSession.mock.calls.map(([id]) => id)).toEqual(['abandoned', 'running']);
  });

  it('does not learn twice when another request ended the session first', async () => {
    mockAdmin(null);
    await endCopilotSession(session(), { status: 'expired', endedAt: NOW });
    expect(mockAfter).not.toHaveBeenCalled();
    expect(rememberFromSession).not.toHaveBeenCalled();
  });

  it('never fails the end: outside a request it starts learning at once, and a failure stays there', async () => {
    mockAdmin();
    mockAfter.mockImplementationOnce(() => {
      throw new Error('`after` was called outside a request scope');
    });
    rememberFromSession.mockRejectedValueOnce(new Error('model down'));

    const { ended, error } = await endCopilotSession(session(), { status: 'stopped', endedAt: NOW });
    expect(error).toBeNull();
    expect(ended?.billableMinutes).toBe(20);
    expect(rememberFromSession).toHaveBeenCalledTimes(1);
  });
});

describe('endOpenCopilotSessions', () => {
  it('expires an abandoned session and stops one still running', async () => {
    const { update } = mockAdmin();
    await endOpenCopilotSessions(
      [
        session({ id: 'abandoned', metadata: { last_heartbeat_at: minutesAgo(30) } }),
        session({ id: 'running' }),
        session({ id: 'done', status: 'stopped' }),
      ],
      NOW,
    );

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'expired', metadata: expect.objectContaining({ expired_reason: 'heartbeat_timeout' }) }),
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'stopped', metadata: expect.objectContaining({ stop_reason: 'replaced_by_new_session' }) }),
    );
    expect(recordCopilotUsage).toHaveBeenCalledTimes(2);
  });
});
