export type CopilotEventCursor = {
  createdAt: string;
  id: string;
};

export type StreamEventRowCursorShape = {
  created_at: string;
  id: string;
};

export function buildEventCursor(createdAt: string, id: string): string {
  return `${createdAt}::${id}`;
}

export function parseEventCursor(raw: string | null): CopilotEventCursor | null {
  if (!raw) return null;

  const parts = raw.split('::');
  if (parts.length !== 2) return null;

  const [createdAt, id] = parts;
  if (!createdAt || !id) return null;
  if (Number.isNaN(new Date(createdAt).getTime())) return null;

  return { createdAt, id };
}

export function isEventAfterCursor(
  row: StreamEventRowCursorShape,
  cursor: CopilotEventCursor,
): boolean {
  if (row.created_at > cursor.createdAt) return true;
  if (row.created_at < cursor.createdAt) return false;
  return row.id > cursor.id;
}

export function filterEventsAfterCursor<T extends StreamEventRowCursorShape>(
  rows: T[],
  cursor: CopilotEventCursor | null,
): T[] {
  if (!cursor) return rows;
  return rows.filter((row) => isEventAfterCursor(row, cursor));
}
