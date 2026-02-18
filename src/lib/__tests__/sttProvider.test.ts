import {
  CircuitBreaker,
  STTProviderRegistry,
  STTAllProvidersFailedError,
  NullSTTProvider,
  FailingSTTProvider,
  buildTranscriptChunk,
  _resetSeqCounter,
} from '@/lib/sttProvider';
import type { STTProvider } from '@/lib/sttProvider';

// ---------------------------------------------------------------------------
// CircuitBreaker unit tests
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  it('starts closed and allows attempts', () => {
    const cb = new CircuitBreaker();
    expect(cb.currentState).toBe('closed');
    expect(cb.canAttempt()).toBe(true);
  });

  it('opens after reaching failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });
    cb.recordFailure();
    expect(cb.currentState).toBe('closed');
    cb.recordFailure();
    expect(cb.currentState).toBe('open');
    expect(cb.canAttempt()).toBe(false);
  });

  it('transitions to half-open after reset timeout', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    cb.recordFailure();
    expect(cb.currentState).toBe('half-open'); // resetTimeoutMs=0 → immediate
    expect(cb.canAttempt()).toBe(true);
  });

  it('resets to closed on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.currentState).toBe('open');
    cb.reset();
    expect(cb.currentState).toBe('closed');
  });

  it('closes from half-open on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.currentState).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// STTProviderRegistry unit tests
// ---------------------------------------------------------------------------

describe('STTProviderRegistry', () => {
  const audio = new ArrayBuffer(8);

  beforeEach(() => {
    _resetSeqCounter();
  });

  it('routes to the first healthy provider', async () => {
    const registry = new STTProviderRegistry();
    const stub: STTProvider = {
      name: 'stub',
      async transcribe() {
        return { text: 'hello world', isFinal: true, confidence: 0.95 };
      },
      async healthCheck() {
        return true;
      },
    };
    registry.register(stub);

    const result = await registry.transcribe(audio);
    expect(result.text).toBe('hello world');
    expect(result.provider).toBe('stub');
    expect(result.isFinal).toBe(true);
  });

  it('falls back when primary provider fails', async () => {
    const registry = new STTProviderRegistry();
    registry.register(new FailingSTTProvider('primary'), { failureThreshold: 1 });
    registry.register(new NullSTTProvider());

    const result = await registry.transcribe(audio);
    expect(result.provider).toBe('null');
  });

  it('throws STTAllProvidersFailedError when all providers fail', async () => {
    const registry = new STTProviderRegistry();
    registry.register(new FailingSTTProvider('a'), { failureThreshold: 1 });
    registry.register(new FailingSTTProvider('b'), { failureThreshold: 1 });

    await expect(registry.transcribe(audio)).rejects.toThrow(STTAllProvidersFailedError);
  });

  it('skips providers with open circuits', async () => {
    const registry = new STTProviderRegistry();
    const callLog: string[] = [];

    const flaky: STTProvider = {
      name: 'flaky',
      async transcribe() {
        callLog.push('flaky');
        throw new Error('down');
      },
      async healthCheck() {
        return false;
      },
    };

    const backup: STTProvider = {
      name: 'backup',
      async transcribe() {
        callLog.push('backup');
        return { text: 'ok', isFinal: true };
      },
      async healthCheck() {
        return true;
      },
    };

    registry.register(flaky, { failureThreshold: 1, resetTimeoutMs: 60_000 });
    registry.register(backup);

    // First call: flaky fails, falls back to backup
    await registry.transcribe(audio);
    expect(callLog).toEqual(['flaky', 'backup']);

    // Second call: flaky circuit is open, goes straight to backup
    callLog.length = 0;
    const result = await registry.transcribe(audio);
    expect(callLog).toEqual(['backup']);
    expect(result.provider).toBe('backup');
    expect(registry.getCircuitState('flaky')).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// buildTranscriptChunk tests
// ---------------------------------------------------------------------------

describe('buildTranscriptChunk', () => {
  beforeEach(() => {
    _resetSeqCounter();
  });

  it('builds a chunk with idempotency key from session+provider+seq', () => {
    const chunk = buildTranscriptChunk('sess-1', {
      text: 'Tell me about yourself',
      isFinal: true,
      confidence: 0.92,
      provider: 'deepgram',
    });

    expect(chunk.idempotencyKey).toBe('sess-1:deepgram:1');
    expect(chunk.state).toBe('final');
    expect(chunk.text).toBe('Tell me about yourself');
    expect(chunk.confidence).toBe(0.92);
  });

  it('marks partial state for non-final results', () => {
    const chunk = buildTranscriptChunk('sess-1', {
      text: 'Tell me about',
      isFinal: false,
      provider: 'whisper',
    });

    expect(chunk.state).toBe('partial');
  });

  it('increments sequence across calls', () => {
    const c1 = buildTranscriptChunk('s', { text: 'a', isFinal: false, provider: 'x' });
    const c2 = buildTranscriptChunk('s', { text: 'b', isFinal: true, provider: 'x' });

    expect(c1.seq).toBe(1);
    expect(c2.seq).toBe(2);
    expect(c1.idempotencyKey).not.toBe(c2.idempotencyKey);
  });
});
