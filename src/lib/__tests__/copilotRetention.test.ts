import { buildCopilotRetentionCutoffs, runCopilotRetentionSweep } from '@/lib/copilotRetention';

describe('copilotRetention policy hooks', () => {
  it('builds deterministic cutoffs from policy + now', () => {
    const now = new Date('2026-02-18T00:00:00.000Z');
    const { policy, cutoffs } = buildCopilotRetentionCutoffs({
      now,
      policy: { eventsDays: 10, summariesDays: 20, sessionsDays: 30 },
    });

    expect(policy).toEqual({ eventsDays: 10, summariesDays: 20, sessionsDays: 30 });
    expect(cutoffs).toEqual({
      eventsBeforeIso: '2026-02-08T00:00:00.000Z',
      summariesBeforeIso: '2026-01-29T00:00:00.000Z',
      sessionsBeforeIso: '2026-01-19T00:00:00.000Z',
    });
  });

  it('defaults retention sweep to dry-run for safety', async () => {
    const admin = {
      from: jest.fn(),
    };

    const result = await runCopilotRetentionSweep(admin as never, { now: new Date('2026-02-18T00:00:00.000Z') });

    expect(result.dryRun).toBe(true);
    expect(result.deleted).toEqual({ events: 0, summaries: 0, sessions: 0 });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('executes deletes in non-dry-run mode with safe session status filter', async () => {
    const eventsLt = jest.fn().mockResolvedValue({ count: 5, error: null });
    const summariesLt = jest.fn().mockResolvedValue({ count: 2, error: null });
    const sessionsLt = jest.fn().mockResolvedValue({ count: 1, error: null });

    const admin = {
      from: jest.fn((table: string) => {
        if (table === 'copilot_events') {
          return { delete: jest.fn(() => ({ lt: eventsLt })) };
        }

        if (table === 'copilot_summaries') {
          return { delete: jest.fn(() => ({ lt: summariesLt })) };
        }

        if (table === 'copilot_sessions') {
          return {
            delete: jest.fn(() => ({
              in: jest.fn((_column: string, values: string[]) => {
                expect(values).toEqual(['stopped', 'expired']);
                return { lt: sessionsLt };
              }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await runCopilotRetentionSweep(admin as never, {
      now: new Date('2026-02-18T00:00:00.000Z'),
      dryRun: false,
    });

    expect(result.dryRun).toBe(false);
    expect(result.deleted).toEqual({ events: 5, summaries: 2, sessions: 1 });
  });
});
