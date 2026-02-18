import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Database query optimization utilities
 * 
 * Provides helpers for:
 * - Pagination with cursor-based navigation
 * - Query result caching
 * - Batch fetches
 * - Select optimization (avoiding over-fetching)
 */

/**
 * Cursor-based pagination helper
 * Use for large datasets where offset pagination would be slow
 */
export interface PaginationParams<T> {
  query: () => Promise<{ data: T[]; error: unknown }>;
  cursor?: string;
  limit: number;
  cursorColumn?: string; // Column to use for cursor (default: 'id')
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function paginate<T>({
  query,
  limit,
  cursorColumn = 'id',
}: PaginationParams<T>): Promise<PaginatedResult<T>> {
  const { data, error } = await query();
  
  if (error) {
    throw error;
  }

  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;
  const nextCursor = hasMore 
    ? String(items[items.length - 1]?.[cursorColumn as keyof T] ?? '')
    : null;

  return {
    data: items,
    nextCursor,
    hasMore,
  };
}

/**
 * Optimize Supabase query by selecting only needed columns
 * Reduces payload size significantly
 */
export type SelectColumns<T> = {
  [K in keyof T]?: boolean;
};

export function optimizeSelect<T extends Record<string, unknown>>(
  table: string,
  columns: (keyof T)[]
): string {
  return columns.join(',');
}

/**
 * Batch fetch multiple records by IDs
 * More efficient than individual fetches
 */
export async function batchFetchByIds<T>(
  table: string,
  ids: string[],
  selectColumns?: string[]
): Promise<Map<string, T>> {
  if (ids.length === 0) return new Map();

  const supabase = createAdminClient();
  
  const query = supabase
    .from(table)
    .select(selectColumns ? selectColumns.join(',') : '*')
    .in('id', ids);

  const { data, error } = await query;

  if (error) {
    console.error(`[db] batchFetch error:`, error);
    throw error;
  }

  const result = new Map<string, T>();
  for (const item of (data as T[]) ?? []) {
    const id = (item as { id: string }).id;
    if (id) result.set(id, item);
  }

  return result;
}

/**
 * Create a cached database query wrapper
 */
export interface CachedQueryOptions {
  cacheKey: string;
  ttlSeconds?: number;
  tableName: string;
  queryFn: () => Promise<unknown>;
}

export async function cachedQuery<T>({
  cacheKey,
  ttlSeconds = 60,
  queryFn,
}: {
  cacheKey: string;
  ttlSeconds?: number;
  queryFn: () => Promise<T>;
}): Promise<T> {
  const { getCache, setCache, cacheOrFetch } = await import('@/lib/cache');
  
  // Try cache first
  const cached = await getCache<T>(cacheKey);
  if (cached.hit && cached.data !== null) {
    return cached.data;
  }

  // Fetch and cache
  const data = await queryFn();
  await setCache(cacheKey, data, { ttlSeconds });
  return data;
}

/**
 * Database query timeout helper
 * Prevents long-running queries from blocking
 */
export async function queryWithTimeout<T>(
  promise: Promise<{ data: T; error: unknown }>,
  timeoutMs: number = 5000
): Promise<{ data: T | null; error: unknown; timedOut: boolean }> {
  let timedOut = false;
  
  const timeoutPromise = new Promise<{ data: null; error: Error; timedOut: boolean }>((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve({ 
        data: null, 
        error: new Error(`Query timed out after ${timeoutMs}ms`), 
        timedOut: true 
      });
    }, timeoutMs);
  });

  const result = await Promise.race([promise, timeoutPromise]) as 
    | { data: T; error: unknown; timedOut: boolean }
    | { data: null; error: Error; timedOut: boolean };

  return result;
}

/**
 * Supabase query builder with common optimizations
 */
export function createOptimizedQuery<T>(supabase: ReturnType<typeof createAdminClient>) {
  return {
    /**
     * Fetch single record with specific columns
     */
    fetchOne: async (
      table: string,
      id: string,
      columns?: string[]
    ): Promise<T | null> => {
      const { data, error } = await supabase
        .from(table)
        .select(columns?.join(',') ?? '*')
        .eq('id', id)
        .single();

      if (error) {
        console.error(`[db] fetchOne error:`, error);
        return null;
      }

      return data as T;
    },

    /**
     * Fetch multiple records with filters and pagination
     */
    fetchMany: async (
      table: string,
      options: {
        filters?: Record<string, unknown>[];
        limit?: number;
        offset?: number;
        orderBy?: string;
        orderDir?: 'asc' | 'desc';
        columns?: string[];
      }
    ): Promise<T[]> => {
      let query = supabase
        .from(table)
        .select(options.columns?.join(',') ?? '*');

      // Apply filters
      if (options.filters) {
        for (const filter of options.filters) {
          for (const [key, value] of Object.entries(filter)) {
            query = query.eq(key, value);
          }
        }
      }

      // Apply ordering
      if (options.orderBy) {
        query = query.order(options.orderBy, { 
          ascending: options.orderDir !== 'desc' 
        });
      }

      // Apply pagination
      if (options.limit) {
        query = query.limit(options.limit);
      }
      if (options.offset) {
        query = query.range(options.offset, options.offset + (options.limit ?? 10) - 1);
      }

      const { data, error } = await query;

      if (error) {
        console.error(`[db] fetchMany error:`, error);
        return [];
      }

      return (data ?? []) as T[];
    },

    /**
     * Count records matching filters (efficient)
     */
    count: async (
      table: string,
      filters?: Record<string, unknown>[]
    ): Promise<number> => {
      let query = supabase.from(table).select('*', { count: 'exact', head: true });

      if (filters) {
        for (const filter of filters) {
          for (const [key, value] of Object.entries(filter)) {
            query = query.eq(key, value);
          }
        }
      }

      const { count, error } = await query;

      if (error) {
        console.error(`[db] count error:`, error);
        return 0;
      }

      return count ?? 0;
    },
  };
}
