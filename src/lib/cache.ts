import { env } from '@/lib/env';

export interface CacheOptions {
  ttlSeconds?: number; // Time to live in seconds (default: 300 = 5 minutes)
  keyPrefix?: string; // Prefix for cache keys (default: 'cache')
}

export interface CacheResult<T> {
  hit: boolean;
  data: T | null;
}

type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
type JSONObject = { [key: string]: JSONValue };
type JSONArray = JSONValue[];

function hasUpstash(): boolean {
  return !!env.UPSTASH_REDIS_REST_URL && !!env.UPSTASH_REDIS_REST_TOKEN;
}

async function upstash(cmd: string, ...args: (string | number)[]) {
  const base = env.UPSTASH_REDIS_REST_URL!;
  const token = env.UPSTASH_REDIS_REST_TOKEN!;

  const path = [cmd, ...args.map((a) => encodeURIComponent(String(a)))].join('/');
  const url = `${base.replace(/\/$/, '')}/${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const json = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!res.ok) {
    throw new Error(json?.error || `Upstash error: ${res.status}`);
  }
  return json?.result;
}

// In-memory cache fallback for development
const memoryCache = new Map<string, { data: string; expiresAt: number }>();

/**
 * Get a value from cache
 */
export async function getCache<T>(key: string): Promise<CacheResult<T>> {
  if (!hasUpstash()) {
    return getMemoryCache<T>(key);
  }

  try {
    const cached = await upstash('get', `cache:${key}`) as string | null;
    if (cached) {
      return { hit: true, data: JSON.parse(cached) as T };
    }
    return { hit: false, data: null };
  } catch (e) {
    console.error('[cache] get error, falling back to memory', e);
    return getMemoryCache<T>(key);
  }
}

/**
 * Set a value in cache
 */
export async function setCache<T>(
  key: string,
  data: T,
  options: CacheOptions = {}
): Promise<void> {
  const { ttlSeconds = 300, keyPrefix = 'cache' } = options;
  const fullKey = `${keyPrefix}:${key}`;

  if (!hasUpstash()) {
    return setMemoryCache(fullKey, data, ttlSeconds);
  }

  try {
    await upstash('set', fullKey, JSON.stringify(data), 'ex', ttlSeconds);
  } catch (e) {
    console.error('[cache] set error, falling back to memory', e);
    setMemoryCache(fullKey, data, ttlSeconds);
  }
}

/**
 * Delete a value from cache
 */
export async function deleteCache(key: string): Promise<void> {
  if (!hasUpstash()) {
    memoryCache.delete(`cache:${key}`);
    return;
  }

  try {
    await upstash('del', `cache:${key}`);
  } catch (e) {
    console.error('[cache] delete error', e);
  }
}

/**
 * Invalidate cache by pattern (useful for tags)
 */
export async function invalidateCache(pattern: string): Promise<number> {
  if (!hasUpstash()) {
    let count = 0;
    for (const key of memoryCache.keys()) {
      if (key.includes(pattern)) {
        memoryCache.delete(key);
        count++;
      }
    }
    return count;
  }

  try {
    // Use SCAN to find matching keys (Upstash supports this)
    const keys = await upstash('keys', `*${pattern}*`) as string[];
    if (keys && keys.length > 0) {
      return Number(await upstash('del', ...keys));
    }
    return 0;
  } catch (e) {
    console.error('[cache] invalidate error', e);
    return 0;
  }
}

// Memory cache implementations
function getMemoryCache<T>(key: string): CacheResult<T> {
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return { hit: true, data: JSON.parse(entry.data) as T };
  }
  if (entry) {
    memoryCache.delete(key);
  }
  return { hit: false, data: null };
}

function setMemoryCache<T>(key: string, data: T, ttlSeconds: number): void {
  memoryCache.set(key, {
    data: JSON.stringify(data),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Helper to create cacheable data fetchers
 * 
 * @example
 * const result = await cacheOrFetch(
 *   'user:123:profile',
 *   () => fetchUserProfile('123'),
 *   { ttlSeconds: 600 }
 * );
 */
export async function cacheOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached.hit && cached.data !== null) {
    return cached.data;
  }

  const data = await fetcher();
  await setCache(key, data, options);
  return data;
}
