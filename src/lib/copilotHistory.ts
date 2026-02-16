export type CopilotHistoryFilters = {
  page: number;
  pageSize: number;
  status?: string;
  mode?: string;
  from?: string;
  to?: string;
};

export type CopilotHistorySessionLite = {
  duration_seconds: number | null;
  consumed_minutes: number | null;
};

export type CopilotUsageAggregate = {
  total_duration_seconds: number;
  total_consumed_minutes: number;
};

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 30;

function sanitizeOptionalString(value: string | null, maxLength = 64): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

export function parseCopilotHistoryFilters(url: URL): CopilotHistoryFilters {
  const page = parsePositiveInt(url.searchParams.get('page'), 1);
  const pageSizeRaw = parsePositiveInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(MAX_PAGE_SIZE, pageSizeRaw);

  const from = sanitizeOptionalString(url.searchParams.get('from'));
  const to = sanitizeOptionalString(url.searchParams.get('to'));

  return {
    page,
    pageSize,
    status: sanitizeOptionalString(url.searchParams.get('status'), 24),
    mode: sanitizeOptionalString(url.searchParams.get('mode'), 24),
    from,
    to,
  };
}

export function computeCopilotUsageAggregate(sessions: CopilotHistorySessionLite[]): CopilotUsageAggregate {
  return sessions.reduce(
    (acc, session) => {
      acc.total_duration_seconds += session.duration_seconds ?? 0;
      acc.total_consumed_minutes += session.consumed_minutes ?? 0;
      return acc;
    },
    {
      total_duration_seconds: 0,
      total_consumed_minutes: 0,
    },
  );
}

export function isIsoDate(value: string | undefined): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export const copilotHistoryLimits = {
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
};
