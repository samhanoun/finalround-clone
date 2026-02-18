/**
 * Rate Limiter for STT Providers
 *
 * Implements token bucket rate limiting per user/organization.
 * Ensures fair usage and prevents quota exhaustion.
 */

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60_000, // 1 minute
};

/**
 * Token bucket rate limiter.
 * Tracks requests per key (user/org) with sliding window.
 */
export class STTRateLimiter {
  private readonly limits = new Map<string, { tokens: number; resetAt: number }>();
  private readonly config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMIT, ...config };
  }

  /**
   * Check and consume a rate limit slot for the given key.
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    let entry = this.limits.get(key);

    // Initialize or reset if window expired
    if (!entry || now >= entry.resetAt) {
      entry = {
        tokens: this.config.maxRequests - 1, // Reserve first token for this request
        resetAt: now + this.config.windowMs,
      };
      this.limits.set(key, entry);
      return {
        allowed: true,
        remaining: entry.tokens,
        resetAt: entry.resetAt,
      };
    }

    // Check if tokens available
    if (entry.tokens <= 0) {
      const retryAfter = entry.resetAt - now;
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfter,
      };
    }

    // Consume a token
    entry.tokens -= 1;
    return {
      allowed: true,
      remaining: entry.tokens,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Get current limit status without consuming.
   */
  peek(key: string): RateLimitResult {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now >= entry.resetAt) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetAt: now + this.config.windowMs,
      };
    }

    return {
      allowed: entry.tokens > 0,
      remaining: entry.tokens,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Reset limit for a key (e.g., on subscription upgrade).
   */
  reset(key: string): void {
    this.limits.delete(key);
  }

  /**
   * Clean up expired entries to prevent memory growth.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (now >= entry.resetAt) {
        this.limits.delete(key);
      }
    }
  }
}

/**
 * Global rate limiter instance.
 */
let _globalLimiter: STTRateLimiter | null = null;

export function getGlobalRateLimiter(): STTRateLimiter {
  if (!_globalLimiter) {
    const maxRequests = parseInt(process.env.STT_RATE_LIMIT_MAX ?? '100', 10);
    const windowMs = parseInt(process.env.STT_RATE_LIMIT_WINDOW ?? '60000', 10);
    _globalLimiter = new STTRateLimiter({ maxRequests, windowMs });
  }
  return _globalLimiter;
}
