/**
 * Latency of each answered question, stage by stage:
 *
 *   speech end → final → gate → first token → done
 *
 * Times are wall-clock milliseconds taken in the browser. Only durations are
 * sent to the server, so client and server clocks never need to agree.
 */

import type { QuestionCategory } from './questionGate';

export type TurnOutcome = 'answered' | 'superseded' | 'stopped' | 'error';

export type TurnTiming = {
  category: QuestionCategory;
  trigger: 'gate' | 'manual';
  via: string;
  outcome: TurnOutcome;
  /** Automatic questions only: when the interviewer stopped talking. */
  speechEndedAt: number | null;
  /** Automatic questions only: when the utterance became final. */
  finalAt: number | null;
  /** When the gate (or Answer now) decided to answer. */
  gateAt: number;
  firstTokenAt: number | null;
  doneAt: number | null;
  /** The answer route's own time to first token (excludes the network). */
  serverTtftMs: number | null;
};

export const LATENCY_STAGES = [
  'speech_to_final',
  'final_to_gate',
  'gate_to_first_token',
  'first_token_to_done',
  'speech_to_first_token',
] as const;

export type LatencyStage = (typeof LATENCY_STAGES)[number];
export type StageDurations = Record<LatencyStage, number | null>;

export const STAGE_LABELS: Record<LatencyStage, string> = {
  speech_to_final: 'Speech end → final',
  final_to_gate: 'Final → gate',
  gate_to_first_token: 'Gate → first token',
  first_token_to_done: 'First token → done',
  speech_to_first_token: 'Speech end → first token',
};

/** Targets from the build plan (Steps 2, 4 and 8), in ms. */
export const STAGE_TARGETS: Partial<Record<LatencyStage, { p50: number; p95?: number }>> = {
  speech_to_final: { p50: 1_000 },
  gate_to_first_token: { p50: 800 },
  speech_to_first_token: { p50: 1_500, p95: 3_000 },
};

const MAX_REASONABLE_MS = 10 * 60_000;

function span(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  const ms = Math.round(to - from);
  // Negative or absurd spans mean a clock jump or a missing event, not a measurement.
  return ms >= 0 && ms <= MAX_REASONABLE_MS ? ms : null;
}

export function stageDurations(turn: TurnTiming): StageDurations {
  return {
    speech_to_final: span(turn.speechEndedAt, turn.finalAt),
    final_to_gate: span(turn.finalAt, turn.gateAt),
    gate_to_first_token: span(turn.gateAt, turn.firstTokenAt),
    first_token_to_done: span(turn.firstTokenAt, turn.doneAt),
    speech_to_first_token: span(turn.speechEndedAt, turn.firstTokenAt),
  };
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

export type StageSummary = { count: number; p50: number | null; p95: number | null };
export type LatencySummary = Record<LatencyStage, StageSummary>;

export function summarizeStages(rows: Array<Partial<StageDurations>>): LatencySummary {
  const summary = {} as LatencySummary;
  for (const stage of LATENCY_STAGES) {
    const values = rows
      .map((row) => row[stage])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .sort((a, b) => a - b);
    summary[stage] = { count: values.length, p50: percentile(values, 50), p95: percentile(values, 95) };
  }
  return summary;
}

/** What a latency event stores (copilot_events, event_type 'system', payload.kind 'latency'). */
export type LatencyEventPayload = StageDurations & {
  kind: 'latency';
  category: QuestionCategory;
  trigger: 'gate' | 'manual';
  via: string;
  outcome: TurnOutcome;
  server_ttft_ms: number | null;
};

export function latencyEventPayload(turn: TurnTiming): LatencyEventPayload {
  return {
    kind: 'latency',
    ...stageDurations(turn),
    category: turn.category,
    trigger: turn.trigger,
    via: turn.via,
    outcome: turn.outcome,
    server_ttft_ms: turn.serverTtftMs,
  };
}

export function isLatencyPayload(payload: unknown): payload is LatencyEventPayload {
  return typeof payload === 'object' && payload !== null && (payload as { kind?: unknown }).kind === 'latency';
}

/** Per-session summary from stored latency events: stage percentiles plus outcome counts. */
export function summarizeLatencyEvents(payloads: unknown[]) {
  const turns = payloads.filter(isLatencyPayload);
  const outcomes: Record<TurnOutcome, number> = { answered: 0, superseded: 0, stopped: 0, error: 0 };
  turns.forEach((turn) => {
    if (turn.outcome in outcomes) outcomes[turn.outcome] += 1;
  });
  const answered = turns.filter((turn) => turn.outcome === 'answered');
  return { turns: turns.length, outcomes, stages: summarizeStages(answered) };
}

export type SessionLatencySummary = ReturnType<typeof summarizeLatencyEvents>;
