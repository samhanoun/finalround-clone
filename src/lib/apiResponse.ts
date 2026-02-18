import { NextRequest, NextResponse } from 'next/server';
import { getCache, setCache, invalidateCache } from '@/lib/cache';

/**
 * API Response cache helper
 * Use this to wrap API route handlers with caching
 */
export interface CacheableRouteOptions {
  ttlSeconds?: number;
  cacheKeyBuilder?: (request: NextRequest) => string;
  varyOn?: string[]; // Headers to vary cache on
}

export async function withCache<T>(
  request: NextRequest,
  handler: () => Promise<T>,
  options: CacheableRouteOptions = {}
): Promise<NextResponse> {
  const { ttlSeconds = 300, cacheKeyBuilder, varyOn = [] } = options;

  // Only cache GET requests
  if (request.method !== 'GET') {
    const data = await handler();
    return NextResponse.json(data);
  }

  // Build cache key
  const baseKey = cacheKeyBuilder 
    ? cacheKeyBuilder(request) 
    : request.nextUrl.pathname + request.nextUrl.search;
    
  // Add vary headers to cache key
  let cacheKey = baseKey;
  for (const header of varyOn) {
    const value = request.headers.get(header);
    if (value) cacheKey += `:${header}=${value}`;
  }

  // Try to get from cache
  try {
    const cached = await getCache<T>(cacheKey);
    if (cached.hit && cached.data !== null) {
      return NextResponse.json(cached.data, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`,
        },
      });
    }
  } catch (e) {
    console.error('[withCache] get error:', e);
  }

  // Execute handler
  const data = await handler();

  // Store in cache
  try {
    await setCache(cacheKey, data, { ttlSeconds });
  } catch (e) {
    console.error('[withCache] set error:', e);
  }

  return NextResponse.json(data, {
    headers: {
      'X-Cache': 'MISS',
      'Cache-Control': `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`,
    },
  });
}

/**
 * Invalidate cache for a specific route pattern
 * Call this after data mutations
 */
export async function invalidateApiCache(pattern: string): Promise<number> {
  return invalidateCache(`api:${pattern}`);
}

/**
 * Response time tracker middleware
 * Adds X-Response-Time header to responses
 */
export function withResponseTime() {
  const start = Date.now();
  
  return function responseTimeMiddleware(response: NextResponse) {
    const duration = Date.now() - start;
    response.headers.set('X-Response-Time', `${duration}ms`);
    return response;
  };
}

/**
 * API route with standard error handling
 */
export async function withErrorHandling<T>(
  handler: () => Promise<T>
): Promise<NextResponse> {
  try {
    const data = await handler();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[API Error]:', error);
    
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = error instanceof Error && 'statusCode' in error 
      ? (error as { statusCode: number }).statusCode 
      : 500;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
