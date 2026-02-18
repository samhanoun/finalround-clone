/**
 * STT Provider Tests
 *
 * Tests for production STT provider factory and rate limiting.
 */

import {
  STTRateLimiter,
  createProductionSTTRegistry,
  getSTTRegistry,
  resetSTTRegistry,
  checkRateLimit,
  validateAuth,
  getRateLimitStatus,
} from '@/lib/sttProviders';

// ---------------------------------------------------------------------------
// STTRateLimiter tests
// ---------------------------------------------------------------------------

describe('STTRateLimiter', () => {
  it('allows first request and returns remaining tokens', () => {
    const limiter = new STTRateLimiter({ maxRequests: 5, windowMs: 60_000 });
    const result = limiter.check('user-1');

    expect(result.allowed).toBe(true);
    // First call consumes one token, so remaining = max - 1
    expect(result.remaining).toBe(4);
  });

  it('tracks remaining across multiple requests', () => {
    const limiter = new STTRateLimiter({ maxRequests: 5, windowMs: 60_000 });
    
    limiter.check('user-1');
    const result = limiter.check('user-1');

    expect(result.remaining).toBe(3);
  });

  it('blocks requests when limit exceeded', () => {
    const limiter = new STTRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    
    limiter.check('user-1'); // remaining: 1
    limiter.check('user-1'); // remaining: 0
    const result = limiter.check('user-1'); // blocked

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeDefined();
  });

  it('tracks limits per key independently', () => {
    const limiter = new STTRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    
    limiter.check('user-1'); // consumes token, remaining: 0
    const result1 = limiter.peek('user-1'); // peek doesn't consume
    
    // user-1 exhausted, user-2 has full allocation
    const result2 = limiter.check('user-2');

    expect(result1.allowed).toBe(false); // user-1 has 0
    expect(result2.allowed).toBe(true); // user-2 has 1
  });

  it('resets limits for a key', () => {
    const limiter = new STTRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    
    limiter.check('user-1'); // consume token
    limiter.check('user-1'); // blocked
    limiter.reset('user-1');
    const result = limiter.check('user-1');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0); // Fresh allocation, first call consumes
  });
});

// ---------------------------------------------------------------------------
// Auth validation tests
// ---------------------------------------------------------------------------

describe('validateAuth', () => {
  it('passes valid auth context', () => {
    expect(() => validateAuth({ userId: 'user-1', tier: 'free' })).not.toThrow();
    expect(() => validateAuth({ userId: 'user-1', orgId: 'org-1', tier: 'pro' })).not.toThrow();
    expect(() => validateAuth({ userId: 'user-1', tier: 'enterprise' })).not.toThrow();
  });

  it('throws if userId is missing', () => {
    expect(() => validateAuth({ userId: '', tier: 'free' })).toThrow('User ID required');
    expect(() => validateAuth({ userId: undefined as unknown as string, tier: 'free' })).toThrow('User ID required');
  });

  it('throws if tier is invalid', () => {
    expect(() => validateAuth({ userId: 'user-1', tier: 'invalid' as 'free' })).toThrow('Invalid subscription tier');
    expect(() => validateAuth({ userId: 'user-1', tier: 'basic' as 'free' })).toThrow('Invalid subscription tier');
  });
});

// ---------------------------------------------------------------------------
// checkRateLimit tests
// ---------------------------------------------------------------------------

describe('checkRateLimit', () => {
  it('passes when under limit', async () => {
    // Note: Uses global limiter - unique user ID to avoid conflicts
    await expect(checkRateLimit({ userId: 'test-user-unique-789', tier: 'free' })).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getRateLimitStatus tests
// ---------------------------------------------------------------------------

describe('getRateLimitStatus', () => {
  it('returns status with tier info', () => {
    const status = getRateLimitStatus('user-123', 'pro');
    
    expect(status).toHaveProperty('allowed');
    expect(status).toHaveProperty('remaining');
    expect(status).toHaveProperty('resetAt');
    expect(status.tier).toBe('pro');
  });
});

// ---------------------------------------------------------------------------
// Factory tests (without SDK initialization issues)
// ---------------------------------------------------------------------------

describe('createProductionSTTRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    resetSTTRegistry();
    // Ensure no API keys are set to avoid SDK initialization
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
  });

  it('creates registry with null provider (fallback)', () => {
    const registry = createProductionSTTRegistry();
    const providers = registry.registeredProviders;

    // Should have at least null provider (fallback)
    expect(providers).toContain('null');
  });
});

// ---------------------------------------------------------------------------
// getSTTRegistry singleton tests
// ---------------------------------------------------------------------------

describe('getSTTRegistry', () => {
  beforeEach(() => {
    resetSTTRegistry();
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
  });

  it('returns same instance on multiple calls', () => {
    const registry1 = getSTTRegistry();
    const registry2 = getSTTRegistry();
    expect(registry1).toBe(registry2);
  });
});
