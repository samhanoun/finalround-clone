/**
 * Latency instrumentation for cop pipeline
 * Tracksilot realtime per-stage timing: ingest, context retrieval, LLM inference, delivery
 */

export type LatencyStage = 
  | 'ingest' 
  | 'transcript_parse' 
  | 'context_retrieval' 
  | 'llm_inference' 
  | 'suggestion_persist' 
  | 'delivery';

export type LatencySnapshot = {
  stage: LatencyStage;
  startedAt: number;  // epoch ms
  endedAt?: number;   // epoch ms
  durationMs?: number;
};

export type CopilotLatencyTimings = {
  requestId: string;
  sessionId: string;
  stages: LatencySnapshot[];
  totalLatencyMs?: number;
};

const activeTimings = new Map<string, CopilotLatencyTimings>();

export function startLatencyTracking(requestId: string, sessionId: string): void {
  activeTimings.set(requestId, {
    requestId,
    sessionId,
    stages: [],
  });
}

export function startStage(requestId: string, stage: LatencyStage): void {
  const timings = activeTimings.get(requestId);
  if (!timings) {
    console.warn('[latency] No active timing for requestId:', requestId);
    return;
  }

  timings.stages.push({
    stage,
    startedAt: Date.now(),
  });
}

export function endStage(requestId: string, stage: LatencyStage): LatencySnapshot | null {
  const timings = activeTimings.get(requestId);
  if (!timings) return null;

  const stageSnapshot = timings.stages.find((s) => s.stage === stage && !s.endedAt);
  if (!stageSnapshot) return null;

  stageSnapshot.endedAt = Date.now();
  stageSnapshot.durationMs = stageSnapshot.endedAt - stageSnapshot.startedAt;
  return stageSnapshot;
}

export function endStageByIndex(requestId: string, stageIndex: number): LatencySnapshot | null {
  const timings = activeTimings.get(requestId);
  if (!timings || stageIndex < 0 || stageIndex >= timings.stages.length) return null;

  const stageSnapshot = timings.stages[stageIndex];
  if (!stageSnapshot || stageSnapshot.endedAt) return null;

  stageSnapshot.endedAt = Date.now();
  stageSnapshot.durationMs = stageSnapshot.endedAt - stageSnapshot.startedAt;
  return stageSnapshot;
}

export function getLatencyTimings(requestId: string): CopilotLatencyTimings | null {
  const timings = activeTimings.get(requestId);
  if (!timings) return null;

  // Calculate total and filter out incomplete stages
  const completeStages = timings.stages.filter((s) => s.endedAt !== undefined);
  const totalLatencyMs = completeStages.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);

  return {
    ...timings,
    stages: completeStages,
    totalLatencyMs,
  };
}

export function clearLatencyTracking(requestId: string): void {
  activeTimings.delete(requestId);
}

export function latencyTimingsToMetadata(timings: CopilotLatencyTimings): Record<string, unknown> {
  const stageDurations: Record<string, number> = {};
  for (const stage of timings.stages) {
    if (stage.durationMs !== undefined) {
      stageDurations[stage.stage] = stage.durationMs;
    }
  }

  return {
    latency: {
      request_id: timings.requestId,
      session_id: timings.sessionId,
      stages: stageDurations,
      total_ms: timings.totalLatencyMs,
    },
  };
}

/**
 * Log latency metrics for observability
 * Outputs structured log for ELK/Datadog etc.
 */
export function logLatencyMetrics(timings: CopilotLatencyTimings, extra?: Record<string, unknown>): void {
  const metric = {
    type: 'copilot_latency',
    request_id: timings.requestId,
    session_id: timings.sessionId,
    total_ms: timings.totalLatencyMs,
    ...extra,
  };

  // Add individual stage timings
  for (const stage of timings.stages) {
    if (stage.durationMs !== undefined) {
      (metric as Record<string, unknown>)[`${stage.stage}_ms`] = stage.durationMs;
    }
  }

  console.log('[latency]', JSON.stringify(metric));
}
