/**
 * STT Provider Adapter Abstraction
 *
 * Implements provider abstraction, retry with circuit-breaker,
 * and deterministic transcript lifecycle (partial → final) with idempotency keys.
 *
 * PRD gap: T1 — Ship production STT adapter with fallback and persistence contract
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranscriptState = 'partial' | 'final' | 'error';

export interface TranscriptChunk {
  /** Idempotency key — deduplicate on ingest */
  idempotencyKey: string;
  /** Session-scoped sequence number */
  seq: number;
  state: TranscriptState;
  text: string;
  /** Provider that produced this chunk */
  provider: string;
  /** Ingestion timestamp (ISO) */
  receivedAt: string;
  /** Provider-reported confidence 0-1, if available */
  confidence?: number;
}

export interface STTProviderResult {
  text: string;
  isFinal: boolean;
  confidence?: number;
  providerMeta?: Record<string, unknown>;
}

export interface STTProvider {
  readonly name: string;
  /** Process a raw audio buffer and return partial/final transcript */
  transcribe(audio: ArrayBuffer, opts?: { language?: string }): Promise<STTProviderResult>;
  /** Health ping — return true if the provider is reachable */
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

const DEFAULT_CB_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureAt = 0;
  private readonly opts: CircuitBreakerOptions;

  constructor(opts?: Partial<CircuitBreakerOptions>) {
    this.opts = { ...DEFAULT_CB_OPTIONS, ...opts };
  }

  get currentState(): CircuitState {
    if (this.state === 'open' && Date.now() - this.lastFailureAt >= this.opts.resetTimeoutMs) {
      return 'half-open';
    }
    return this.state;
  }

  canAttempt(): boolean {
    const s = this.currentState;
    return s === 'closed' || s === 'half-open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    this.lastFailureAt = Date.now();
    if (this.failures >= this.opts.failureThreshold) {
      this.state = 'open';
    }
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
    this.lastFailureAt = 0;
  }
}

// ---------------------------------------------------------------------------
// Provider Registry (fallback chain)
// ---------------------------------------------------------------------------

export class STTProviderRegistry {
  private readonly providers: Array<{ provider: STTProvider; cb: CircuitBreaker }> = [];

  register(provider: STTProvider, cbOpts?: Partial<CircuitBreakerOptions>): void {
    this.providers.push({ provider, cb: new CircuitBreaker(cbOpts) });
  }

  /**
   * Attempt transcription across the provider chain.
   * First healthy + circuit-closed provider wins; others are fallbacks.
   */
  async transcribe(audio: ArrayBuffer, opts?: { language?: string }): Promise<STTProviderResult & { provider: string }> {
    const errors: Array<{ provider: string; error: unknown }> = [];

    for (const entry of this.providers) {
      if (!entry.cb.canAttempt()) {
        errors.push({ provider: entry.provider.name, error: 'circuit_open' });
        continue;
      }

      try {
        const result = await entry.provider.transcribe(audio, opts);
        entry.cb.recordSuccess();
        return { ...result, provider: entry.provider.name };
      } catch (err) {
        entry.cb.recordFailure();
        errors.push({ provider: entry.provider.name, error: err });
      }
    }

    throw new STTAllProvidersFailedError(errors);
  }

  get registeredProviders(): string[] {
    return this.providers.map((e) => e.provider.name);
  }

  getCircuitState(providerName: string): CircuitState | undefined {
    return this.providers.find((e) => e.provider.name === providerName)?.cb.currentState;
  }
}

export class STTAllProvidersFailedError extends Error {
  constructor(public readonly providerErrors: Array<{ provider: string; error: unknown }>) {
    super(`All STT providers failed: ${providerErrors.map((e) => e.provider).join(', ')}`);
    this.name = 'STTAllProvidersFailedError';
  }
}

// ---------------------------------------------------------------------------
// Transcript Chunk Builder (idempotent)
// ---------------------------------------------------------------------------

let _seqCounter = 0;

export function buildTranscriptChunk(
  sessionId: string,
  result: STTProviderResult & { provider: string },
  overrideSeq?: number,
): TranscriptChunk {
  const seq = overrideSeq ?? ++_seqCounter;
  return {
    idempotencyKey: `${sessionId}:${result.provider}:${seq}`,
    seq,
    state: result.isFinal ? 'final' : 'partial',
    text: result.text,
    provider: result.provider,
    receivedAt: new Date().toISOString(),
    confidence: result.confidence,
  };
}

/** Reset sequence counter (for testing) */
export function _resetSeqCounter(): void {
  _seqCounter = 0;
}

// ---------------------------------------------------------------------------
// Null / Stub Provider (for tests & offline dev)
// ---------------------------------------------------------------------------

export class NullSTTProvider implements STTProvider {
  readonly name = 'null';
  async transcribe(): Promise<STTProviderResult> {
    return { text: '', isFinal: true, confidence: 0 };
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

export class FailingSTTProvider implements STTProvider {
  readonly name: string;
  constructor(name = 'failing') {
    this.name = name;
  }
  async transcribe(): Promise<STTProviderResult> {
    throw new Error(`${this.name}_provider_unavailable`);
  }
  async healthCheck(): Promise<boolean> {
    return false;
  }
}
