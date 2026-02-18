/**
 * Connection pooling utilities for database connections
 * 
 * Supabase handles connection pooling automatically, but we can
 * optimize our usage patterns to reduce connection overhead.
 */

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Shared Supabase admin client for connection reuse
 * Using a singleton pattern to ensure connection pooling works effectively
 */
let adminClient: ReturnType<typeof createAdminClient> | null = null;

export function getAdminClient() {
  if (!adminClient) {
    adminClient = createAdminClient();
  }
  return adminClient;
}

/**
 * Database connection health check
 */
export async function checkConnectionHealth(): Promise<boolean> {
  try {
    const client = getAdminClient();
    const { error } = await client.from('_prisma_migrations').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Prepared query cache to avoid re-creating query builders
 */
const queryCache = new Map<string, unknown>();

export function getCachedQuery<T>(key: string): T | undefined {
  return queryCache.get(key) as T | undefined;
}

export function setCachedQuery<T>(key: string, value: T): void {
  // Limit cache size to prevent memory issues
  if (queryCache.size > 100) {
    const firstKey = queryCache.keys().next().value;
    if (firstKey) queryCache.delete(firstKey);
  }
  queryCache.set(key, value);
}

export function clearQueryCache(): void {
  queryCache.clear();
}

/**
 * Batch connection manager
 * Groups multiple queries to execute them more efficiently
 */
export interface BatchItem<T> {
  id: string;
  query: () => Promise<T>;
}

export async function executeBatch<T>(
  items: BatchItem<T>[],
  concurrency: number = 5
): Promise<Map<string, T>> {
  const results = new Map<string, T>();
  const errors = new Map<string, Error>();

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const promises = batch.map(async (item) => {
      try {
        const result = await item.query();
        results.set(item.id, result);
      } catch (e) {
        errors.set(item.id, e as Error);
      }
    });
    await Promise.allSettled(promises);
  }

  if (errors.size > 0) {
    console.error(`[batch] ${errors.size} items failed:`, errors);
  }

  return results;
}
