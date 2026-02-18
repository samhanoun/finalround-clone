import {
  startLatencyTracking,
  startStage,
  endStage,
  getLatencyTimings,
  clearLatencyTracking,
  latencyTimingsToMetadata,
  logLatencyMetrics,
} from '@/lib/copilotLatency';

describe('copilotLatency', () => {
  afterEach(() => {
    // Clean up any lingering timings after each test
    jest.restoreAllMocks();
  });

  describe('startLatencyTracking', () => {
    it('creates a new latency tracking entry', () => {
      startLatencyTracking('req-123', 'session-abc');
      const timings = getLatencyTimings('req-123');
      expect(timings).not.toBeNull();
      expect(timings?.requestId).toBe('req-123');
      expect(timings?.sessionId).toBe('session-abc');
      expect(timings?.stages).toEqual([]);
      clearLatencyTracking('req-123');
    });
  });

  describe('startStage / endStage', () => {
    it('tracks individual stage durations', () => {
      startLatencyTracking('req-456', 'session-xyz');
      startStage('req-456', 'ingest');
      
      // Simulate some async work
      const startTime = Date.now();
      while (Date.now() - startTime < 10) { /* busy wait for minimum delay */ }
      
      endStage('req-456', 'ingest');
      
      const timings = getLatencyTimings('req-456');
      expect(timings?.stages).toHaveLength(1);
      expect(timings?.stages[0].stage).toBe('ingest');
      expect(timings?.stages[0].durationMs).toBeGreaterThanOrEqual(10);
      
      clearLatencyTracking('req-456');
    });

    it('returns null for non-existent request', () => {
      const result = endStage('nonexistent', 'ingest');
      expect(result).toBeNull();
    });

    it('returns null when stage not found', () => {
      startLatencyTracking('req-789', 'session-abc');
      const result = endStage('req-789', 'llm_inference');
      expect(result).toBeNull();
      clearLatencyTracking('req-789');
    });
  });

  describe('getLatencyTimings', () => {
    it('calculates total latency from completed stages', () => {
      startLatencyTracking('req-total', 'session-total');
      startStage('req-total', 'ingest');
      endStage('req-total', 'ingest');
      startStage('req-total', 'llm_inference');
      endStage('req-total', 'llm_inference');
      
      const timings = getLatencyTimings('req-total');
      expect(timings?.totalLatencyMs).toBeDefined();
      expect(timings?.totalLatencyMs).toBeGreaterThanOrEqual(0);
      
      clearLatencyTracking('req-total');
    });

    it('returns null for non-existent request', () => {
      expect(getLatencyTimings('does-not-exist')).toBeNull();
    });
  });

  describe('clearLatencyTracking', () => {
    it('removes tracking for a request', () => {
      startLatencyTracking('req-clear', 'session-clear');
      clearLatencyTracking('req-clear');
      expect(getLatencyTimings('req-clear')).toBeNull();
    });
  });

  describe('latencyTimingsToMetadata', () => {
    it('converts timings to metadata object for event payload', () => {
      startLatencyTracking('req-meta', 'session-meta');
      startStage('req-meta', 'ingest');
      endStage('req-meta', 'ingest');
      startStage('req-meta', 'llm_inference');
      endStage('req-meta', 'llm_inference');
      
      const timings = getLatencyTimings('req-meta')!;
      const meta = latencyTimingsToMetadata(timings);
      
      expect(meta).toHaveProperty('latency');
      expect((meta.latency as Record<string, unknown>)).toHaveProperty('request_id', 'req-meta');
      expect((meta.latency as Record<string, unknown>)).toHaveProperty('session_id', 'session-meta');
      expect((meta.latency as Record<string, unknown>)).toHaveProperty('stages');
      expect((meta.latency as Record<string, unknown>)).toHaveProperty('total_ms');
      
      clearLatencyTracking('req-meta');
    });
  });

  describe('logLatencyMetrics', () => {
    it('outputs structured JSON log', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      startLatencyTracking('req-log', 'session-log');
      startStage('req-log', 'ingest');
      endStage('req-log', 'ingest');
      
      const timings = getLatencyTimings('req-log')!;
      logLatencyMetrics(timings);
      
      expect(consoleSpy).toHaveBeenCalled();
      const loggedOutput = consoleSpy.mock.calls[0][1];
      const parsed = JSON.parse(loggedOutput);
      expect(parsed.type).toBe('copilot_latency');
      expect(parsed.request_id).toBe('req-log');
      expect(parsed.session_id).toBe('session-log');
      
      consoleSpy.mockRestore();
      clearLatencyTracking('req-log');
    });

    it('includes extra metadata when provided', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      startLatencyTracking('req-extra', 'session-extra');
      startStage('req-extra', 'ingest');
      endStage('req-extra', 'ingest');
      
      const timings = getLatencyTimings('req-extra')!;
      logLatencyMetrics(timings, { error: 'test_error', user_id: 'user-123' });
      
      const loggedOutput = consoleSpy.mock.calls[0][1];
      const parsed = JSON.parse(loggedOutput);
      expect(parsed.error).toBe('test_error');
      expect(parsed.user_id).toBe('user-123');
      
      consoleSpy.mockRestore();
      clearLatencyTracking('req-extra');
    });
  });

  describe('full pipeline simulation', () => {
    it('tracks all stages of the copilot suggestion pipeline', () => {
      const requestId = 'req-pipeline';
      const sessionId = 'session-pipeline';
      
      // Simulate the full pipeline
      startLatencyTracking(requestId, sessionId);
      
      // 1. Ingest
      startStage(requestId, 'ingest');
      endStage(requestId, 'ingest');
      
      // 2. Transcript parse
      startStage(requestId, 'transcript_parse');
      endStage(requestId, 'transcript_parse');
      
      // 3. Suggestion persist (event insert)
      startStage(requestId, 'suggestion_persist');
      endStage(requestId, 'suggestion_persist');
      
      // 4. Context retrieval (if suggestion enabled)
      startStage(requestId, 'context_retrieval');
      endStage(requestId, 'context_retrieval');
      
      // 5. LLM inference
      startStage(requestId, 'llm_inference');
      endStage(requestId, 'llm_inference');
      
      // 6. Delivery (response sent)
      startStage(requestId, 'delivery');
      endStage(requestId, 'delivery');
      
      const timings = getLatencyTimings(requestId);
      expect(timings?.stages).toHaveLength(6);
      expect(timings?.totalLatencyMs).toBeDefined();
      expect(timings?.totalLatencyMs).toBeGreaterThanOrEqual(0);
      
      // All stages should have durations
      for (const stage of timings!.stages) {
        expect(stage.durationMs).toBeDefined();
        expect(stage.durationMs).toBeGreaterThanOrEqual(0);
      }
      
      clearLatencyTracking(requestId);
    });
  });
});
