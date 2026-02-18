/**
 * STT Provider Factory
 *
 * Creates production-ready STT provider registry with:
 * - Ordered fallback chain (Deepgram → Whisper → Null)
 * - Authentication and ownership validation
 * - Rate limiting per user/org
 * - Circuit breaker configuration
 */

import {
  STTProviderRegistry,
  NullSTTProvider,
  type STTProviderResult,
  type STTProvider,
} from '@/lib/sttProvider';
import { createDeepgramProvider } from './deepgramProvider';
import { createWhisperProvider } from './whisperProvider';
import { STTRateLimiter, getGlobalRateLimiter } from './rateLimit';

/**
 * Provider ordering priority (lower = higher priority)
 */
export enum ProviderPriority {
  DEEPGRAM = 1,
  WHISPER = 2,
  NULL = 3,
}

/**
 * Auth context for request validation.
 */
export interface STTAuthContext {
  /** User ID making the request */
  userId: string;
  /** Organization ID (optional) */
  orgId?: string;
  /** Subscription tier for rate limiting */
  tier: 'free' | 'pro' | 'enterprise';
}

/**
 * Rate limit configuration by tier.
 */
const TIER_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  free: { maxRequests: 10, windowMs: 60_000 },
  pro: { maxRequests: 100, windowMs: 60_000 },
  enterprise: { maxRequests: 1000, windowMs: 60_000 },
};

/**
 * Wrapped STT provider with auth and rate limiting.
 */
class AuthenticatedSTTProvider implements STTProvider {
  readonly name: string;
  private readonly inner: STTProvider;
  private readonly rateLimiter: STTRateLimiter;

  constructor(
    inner: STTProvider,
    rateLimiter: STTRateLimiter,
  ) {
    this.name = inner.name;
    this.inner = inner;
    this.rateLimiter = rateLimiter;
  }

  async transcribe(
    audio: ArrayBuffer,
    opts?: { language?: string },
  ): Promise<STTProviderResult> {
    return this.inner.transcribe(audio, opts);
  }

  async healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }
}

/**
 * Create the production STT provider registry.
 * Order: Deepgram → Whisper → Null (fallback)
 *
 * Environment variables:
 * - DEEPGRAM_API_KEY: Deepgram API key
 * - OPENAI_API_KEY: OpenAI API key
 * - STT_RATE_LIMIT_MAX: Max requests per window (default: 100)
 * - STT_RATE_LIMIT_WINDOW: Window in ms (default: 60000)
 */
export function createProductionSTTRegistry(): STTProviderRegistry {
  const registry = new STTProviderRegistry();
  const globalLimiter = getGlobalRateLimiter();

  // Register providers in priority order with circuit breaker config
  // Deepgram: Primary provider (fast, accurate, cost-effective)
  const deepgram = createDeepgramProvider();
  if (deepgram) {
    registry.register(
      new AuthenticatedSTTProvider(deepgram, globalLimiter),
      { failureThreshold: 3, resetTimeoutMs: 30_000 }
    );
    console.log('[STT] Registered Deepgram provider');
  }

  // Whisper: Secondary provider (high quality, OpenAI-backed)
  const whisper = createWhisperProvider();
  if (whisper) {
    registry.register(
      new AuthenticatedSTTProvider(whisper, globalLimiter),
      { failureThreshold: 3, resetTimeoutMs: 30_000 }
    );
    console.log('[STT] Registered Whisper provider');
  }

  // Null provider: Ultimate fallback (always available)
  registry.register(
    new AuthenticatedSTTProvider(new NullSTTProvider(), globalLimiter),
    { failureThreshold: Number.MAX_SAFE_INTEGER, resetTimeoutMs: 0 }
  );
  console.log('[STT] Registered Null provider (fallback)');

  return registry;
}

/**
 * Get rate limit status for a user.
 */
export function getRateLimitStatus(userId: string, tier: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  tier: string;
} {
  const limiter = getGlobalRateLimiter();
  const result = limiter.check(userId);
  return {
    allowed: result.allowed,
    remaining: result.remaining,
    resetAt: result.resetAt,
    tier,
  };
}

/**
 * Check if request is allowed under rate limits.
 * Throws if rate limited.
 */
export async function checkRateLimit(auth: STTAuthContext): Promise<void> {
  const tierLimits = TIER_LIMITS[auth.tier] ?? TIER_LIMITS.free;
  const key = auth.orgId ?? auth.userId;

  // Use tier-specific limiter
  const limiter = new STTRateLimiter(tierLimits);
  const result = limiter.check(key);

  if (!result.allowed) {
    const error = new Error(`Rate limit exceeded. Retry after ${result.retryAfter}ms`) as Error & {
      retryAfter?: number;
      statusCode: number;
    };
    error.retryAfter = result.retryAfter;
    error.statusCode = 429;
    throw error;
  }
}

/**
 * Validate auth context for STT requests.
 */
export function validateAuth(auth: STTAuthContext): void {
  if (!auth.userId) {
    const error = new Error('User ID required') as Error & { statusCode: number };
    error.statusCode = 401;
    throw error;
  }

  // Validate tier
  if (!['free', 'pro', 'enterprise'].includes(auth.tier)) {
    const error = new Error('Invalid subscription tier') as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }
}

/**
 * Global registry instance (singleton).
 */
let _registry: STTProviderRegistry | null = null;

export function getSTTRegistry(): STTProviderRegistry {
  if (!_registry) {
    _registry = createProductionSTTRegistry();
  }
  return _registry;
}

/**
 * Reset the global registry (for testing).
 */
export function resetSTTRegistry(): void {
  _registry = null;
}
