import {
  buildEventCursor,
  filterEventsAfterCursor,
  isEventAfterCursor,
  parseEventCursor,
} from '@/lib/copilotStreamCursor';

describe('copilotStreamCursor', () => {
  it('parses valid cursor and preserves timestamp + id', () => {
    const cursor = parseEventCursor('2026-02-16T08:00:00.000Z::evt_123');

    expect(cursor).toEqual({
      createdAt: '2026-02-16T08:00:00.000Z',
      id: 'evt_123',
    });
  });

  it('rejects malformed cursor values', () => {
    expect(parseEventCursor(null)).toBeNull();
    expect(parseEventCursor('')).toBeNull();
    expect(parseEventCursor('abc')).toBeNull();
    expect(parseEventCursor('not-a-date::evt')).toBeNull();
    expect(parseEventCursor('2026-02-16T08:00:00.000Z::')).toBeNull();
  });

  it('compares same-timestamp events using id as tie-breaker', () => {
    const cursor = parseEventCursor('2026-02-16T08:00:00.000Z::evt_2');
    expect(cursor).not.toBeNull();
    if (!cursor) throw new Error('cursor parse failed');

    expect(
      isEventAfterCursor(
        { created_at: '2026-02-16T08:00:00.000Z', id: 'evt_1' },
        cursor,
      ),
    ).toBe(false);

    expect(
      isEventAfterCursor(
        { created_at: '2026-02-16T08:00:00.000Z', id: 'evt_3' },
        cursor,
      ),
    ).toBe(true);
  });

  it('filters rows after cursor without dropping later timestamps', () => {
    const cursor = parseEventCursor(buildEventCursor('2026-02-16T08:00:00.000Z', 'evt_2'));

    const rows = [
      { id: 'evt_1', created_at: '2026-02-16T08:00:00.000Z' },
      { id: 'evt_2', created_at: '2026-02-16T08:00:00.000Z' },
      { id: 'evt_3', created_at: '2026-02-16T08:00:00.000Z' },
      { id: 'evt_4', created_at: '2026-02-16T08:00:00.500Z' },
    ];

    const filtered = filterEventsAfterCursor(rows, cursor);

    expect(filtered).toEqual([
      { id: 'evt_3', created_at: '2026-02-16T08:00:00.000Z' },
      { id: 'evt_4', created_at: '2026-02-16T08:00:00.500Z' },
    ]);
  });
});
