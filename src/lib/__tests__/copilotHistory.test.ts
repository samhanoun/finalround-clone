import {
  computeCopilotUsageAggregate,
  copilotHistoryLimits,
  isIsoDate,
  parseCopilotHistoryFilters,
} from '@/lib/copilotHistory';

describe('parseCopilotHistoryFilters', () => {
  it('uses defaults for missing params', () => {
    const filters = parseCopilotHistoryFilters(new URL('https://example.com/api/copilot/sessions/history'));

    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(copilotHistoryLimits.DEFAULT_PAGE_SIZE);
    expect(filters.status).toBeUndefined();
    expect(filters.mode).toBeUndefined();
  });

  it('clamps pagination and trims filter values', () => {
    const filters = parseCopilotHistoryFilters(
      new URL('https://example.com/api/copilot/sessions/history?page=2&pageSize=999&status=%20active%20&mode=%20smart%20'),
    );

    expect(filters.page).toBe(2);
    expect(filters.pageSize).toBe(copilotHistoryLimits.MAX_PAGE_SIZE);
    expect(filters.status).toBe('active');
    expect(filters.mode).toBe('smart');
  });
});

describe('computeCopilotUsageAggregate', () => {
  it('sums nullable usage values safely', () => {
    const usage = computeCopilotUsageAggregate([
      { duration_seconds: 60, consumed_minutes: 1 },
      { duration_seconds: null, consumed_minutes: 2 },
      { duration_seconds: 120, consumed_minutes: null },
    ]);

    expect(usage.total_duration_seconds).toBe(180);
    expect(usage.total_consumed_minutes).toBe(3);
  });
});

describe('isIsoDate', () => {
  it('accepts valid timestamps and rejects invalid values', () => {
    expect(isIsoDate('2026-02-16T00:00:00.000Z')).toBe(true);
    expect(isIsoDate('not-a-date')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});
