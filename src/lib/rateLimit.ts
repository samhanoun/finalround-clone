import { env } from '@/lib/env';

type Result = { ok: true } | { ok: false; retryAfterMs: number };

// Fallback in-memory limiter (dev / no Upstash configured)
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function hasUpstash() {
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
    // no body for command-style endpoints
  });

  const json = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!res.ok) {
    throw new Error(json?.error || `Upstash error: ${res.status}`);
  }
  return json?.result;
}

export async function rateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<Result> {
  if (!hasUpstash()) return rateLimitMemory({ key, limit, windowMs });

  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const redisKey = `rl:${key}`;

  try {
    // INCR key
    const count = Number(await upstash('incr', redisKey));

    // Ensure expiry is set
    const ttl = Number(await upstash('ttl', redisKey));
    if (ttl <= 0) {
      await upstash('expire', redisKey, ttlSeconds);
    }

    if (count > limit) {
      const retryAfterSec = Math.max(1, Number(await upstash('ttl', redisKey)));
      return { ok: false, retryAfterMs: retryAfterSec * 1000 };
    }

    return { ok: true };
  } catch (e) {
    // Fail-open if Upstash is down (keeps app available), but still protects on normal ops.
    console.error('[rateLimit] upstash error, falling back to memory', e);
    return rateLimitMemory({ key, limit, windowMs });
  }
}

function rateLimitMemory({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): Result {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (existing.count >= limit) {
    return { ok: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { ok: true };
}
