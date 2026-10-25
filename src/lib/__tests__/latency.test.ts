import {
  latencyEventPayload,
  percentile,
  stageDurations,
  summarizeLatencyEvents,
  summarizeStages,
  type TurnTiming,
} from '@/lib/copilot/latency';

function turn(partial: Partial<TurnTiming> = {}): TurnTiming {
  return {
    category: 'behavioral',
    trigger: 'gate',
    via: 'heuristic',
    outcome: 'answered',
    speechEndedAt: 10_000,
    finalAt: 10_400,
    gateAt: 10_420,
    firstTokenAt: 11_100,
    doneAt: 13_000,
    serverTtftMs: 520,
    ...partial,
  };
}

describe('latency stages', () => {
  it('splits a turn into speech → final → gate → first token → done', () => {
    expect(stageDurations(turn())).toEqual({
      speech_to_final: 400,
      final_to_gate: 20,
      gate_to_first_token: 680,
      first_token_to_done: 1_900,
      speech_to_first_token: 1_100,
    });
  });

  it('leaves out stages a manual question or an unfinished answer cannot have', () => {
    expect(stageDurations(turn({ trigger: 'manual', speechEndedAt: null, finalAt: null, firstTokenAt: null, doneAt: null }))).toEqual({
      speech_to_final: null,
      final_to_gate: null,
      gate_to_first_token: null,
      first_token_to_done: null,
      speech_to_first_token: null,
    });
  });

  it('treats negative or absurd spans as missing (clock jumps)', () => {
    const stages = stageDurations(turn({ finalAt: 9_000, doneAt: 10_000 + 11 * 60_000 }));
    expect(stages.speech_to_final).toBeNull();
    expect(stages.first_token_to_done).toBeNull();
  });
});

describe('percentiles and summaries', () => {
  it('uses nearest-rank percentiles', () => {
    const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 100); // 100..2000
    expect(percentile(sorted, 50)).toBe(1_000);
    expect(percentile(sorted, 95)).toBe(1_900);
    expect(percentile([700], 95)).toBe(700);
    expect(percentile([], 50)).toBeNull();
  });

  it('summarizes each stage over the samples that have it', () => {
    const summary = summarizeStages([
      stageDurations(turn()),
      stageDurations(turn({ firstTokenAt: 12_000 })),
      stageDurations(turn({ trigger: 'manual', speechEndedAt: null, finalAt: null })),
    ]);
    expect(summary.speech_to_first_token).toEqual({ count: 2, p50: 1_100, p95: 2_000 });
    expect(summary.gate_to_first_token.count).toBe(3);
  });

  it('builds per-session summaries from stored events, over answered questions only', () => {
    const payloads = [
      latencyEventPayload(turn()),
      latencyEventPayload(turn({ outcome: 'superseded', firstTokenAt: null, doneAt: null })),
      latencyEventPayload(turn({ outcome: 'error', firstTokenAt: null, doneAt: null })),
      { speaker: 'interviewer', text: 'not a latency row' },
    ];
    const summary = summarizeLatencyEvents(payloads);
    expect(summary.turns).toBe(3);
    expect(summary.outcomes).toEqual({ answered: 1, superseded: 1, stopped: 0, error: 1 });
    expect(summary.stages.speech_to_first_token).toEqual({ count: 1, p50: 1_100, p95: 1_100 });
  });

  it('stores durations, not timestamps', () => {
    expect(latencyEventPayload(turn())).toEqual({
      kind: 'latency',
      speech_to_final: 400,
      final_to_gate: 20,
      gate_to_first_token: 680,
      first_token_to_done: 1_900,
      speech_to_first_token: 1_100,
      category: 'behavioral',
      trigger: 'gate',
      via: 'heuristic',
      outcome: 'answered',
      server_ttft_ms: 520,
    });
  });
});
