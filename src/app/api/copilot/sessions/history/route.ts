import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { jsonError } from '@/lib/api';
import { copilotOk, copilotRateLimited } from '@/lib/copilotApiResponse';
import { computeCopilotUsageAggregate, isIsoDate, parseCopilotHistoryFilters } from '@/lib/copilotHistory';

function getClientIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);

  const anonymousRl = await rateLimit({ key: `copilot:history:anon:${ip}`, limit: 60, windowMs: 60_000 });
  if (!anonymousRl.ok) return copilotRateLimited();

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const userId = userData.user.id;
  const userRl = await rateLimit({ key: `copilot:history:user:${userId}`, limit: 120, windowMs: 60_000 });
  if (!userRl.ok) return copilotRateLimited();

  const filters = parseCopilotHistoryFilters(req.nextUrl);
  if ((filters.from && !isIsoDate(filters.from)) || (filters.to && !isIsoDate(filters.to))) {
    return jsonError(400, 'invalid_date_filter');
  }

  const fromIndex = (filters.page - 1) * filters.pageSize;
  const toIndex = fromIndex + filters.pageSize - 1;

  let sessionsQuery = supabase
    .from('copilot_sessions')
    .select(
      'id, title, metadata, status, started_at, stopped_at, duration_seconds, consumed_minutes, created_at, copilot_summaries(summary_type, content, created_at, updated_at)',
      { count: 'exact' },
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(fromIndex, toIndex);

  let aggregateQuery = supabase
    .from('copilot_sessions')
    .select('duration_seconds, consumed_minutes')
    .eq('user_id', userId);

  if (filters.status) {
    sessionsQuery = sessionsQuery.eq('status', filters.status);
    aggregateQuery = aggregateQuery.eq('status', filters.status);
  }

  if (filters.mode) {
    sessionsQuery = sessionsQuery.contains('metadata', { mode: filters.mode });
    aggregateQuery = aggregateQuery.contains('metadata', { mode: filters.mode });
  }

  if (filters.from) {
    sessionsQuery = sessionsQuery.gte('created_at', filters.from);
    aggregateQuery = aggregateQuery.gte('created_at', filters.from);
  }

  if (filters.to) {
    sessionsQuery = sessionsQuery.lte('created_at', filters.to);
    aggregateQuery = aggregateQuery.lte('created_at', filters.to);
  }

  const [{ data: sessions, error: sessionsError, count }, { data: aggregateRows, error: aggregateError }] = await Promise.all([
    sessionsQuery,
    aggregateQuery,
  ]);

  if (sessionsError) return jsonError(500, 'db_error', sessionsError);
  if (aggregateError) return jsonError(500, 'db_error', aggregateError);

  const totals = computeCopilotUsageAggregate(aggregateRows ?? []);

  return copilotOk({
    sessions: sessions ?? [],
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total: count ?? 0,
      totalPages: Math.max(1, Math.ceil((count ?? 0) / filters.pageSize)),
    },
    filters: {
      status: filters.status ?? null,
      mode: filters.mode ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
    usage: totals,
  });
}
