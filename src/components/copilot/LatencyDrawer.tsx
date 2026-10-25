'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  LATENCY_STAGES,
  STAGE_LABELS,
  STAGE_TARGETS,
  stageDurations,
  summarizeStages,
  type LatencyStage,
  type LatencySummary,
  type StageSummary,
} from '@/lib/copilot/latency';
import type { CopilotAnswers } from './useCopilotAnswers';
import styles from '../LiveCopilotClient.module.css';

const OUTCOME_LABEL = { answered: 'Answered', superseded: 'Replaced', stopped: 'Stopped', error: 'Failed' } as const;

function ms(value: number | null): string {
  if (value === null) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`;
}

function overTarget(stage: LatencyStage, summary: StageSummary): boolean {
  const target = STAGE_TARGETS[stage];
  if (!target) return false;
  return (summary.p50 !== null && summary.p50 > target.p50) || (target.p95 !== undefined && summary.p95 !== null && summary.p95 > target.p95);
}

function targetLabel(stage: LatencyStage): string {
  const target = STAGE_TARGETS[stage];
  if (!target) return '';
  return `p50 ≤ ${ms(target.p50)}${target.p95 ? `, p95 ≤ ${ms(target.p95)}` : ''}`;
}

/** p50/p95 per stage. Shared by the live drawer and the history view. */
export function LatencyTable({ summary, caption }: { summary: LatencySummary; caption: string }) {
  return (
    <table className={styles.latencyTable}>
      <caption className="small">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Stage</th>
          <th scope="col">p50</th>
          <th scope="col">p95</th>
          <th scope="col">Samples</th>
          <th scope="col">Target</th>
        </tr>
      </thead>
      <tbody>
        {LATENCY_STAGES.map((stage) => (
          <tr key={stage} className={overTarget(stage, summary[stage]) ? styles.latencyOver : undefined}>
            <th scope="row">{STAGE_LABELS[stage]}</th>
            <td>{ms(summary[stage].p50)}</td>
            <td>{ms(summary[stage].p95)}</td>
            <td>{summary[stage].count}</td>
            <td className="small">{targetLabel(stage)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Debug drawer: how long each question took this session, stage by stage,
 * with p50/p95 over answered questions.
 */
export function LatencyDrawer({ answers }: { answers: Pick<CopilotAnswers, 'subscribeTurns' | 'getTurns'> }) {
  const turns = useSyncExternalStore(answers.subscribeTurns, answers.getTurns, answers.getTurns);
  const rows = useMemo(() => turns.map((turn) => ({ turn, stages: stageDurations(turn) })), [turns]);
  const summary = useMemo(
    () => summarizeStages(rows.filter((row) => row.turn.outcome === 'answered').map((row) => row.stages)),
    [rows],
  );

  return (
    <details className={styles.settingsCard}>
      <summary className="small" style={{ cursor: 'pointer' }}>
        <strong>Latency</strong>: {turns.length} {turns.length === 1 ? 'question' : 'questions'} this session
        {summary.speech_to_first_token.p50 !== null
          ? ` · speech end → first words p50 ${ms(summary.speech_to_first_token.p50)}`
          : ''}
      </summary>

      {turns.length === 0 ? (
        <p className="small" style={{ margin: '8px 0 0' }}>
          Timings appear after the first answered question.
        </p>
      ) : (
        <div className="stack" style={{ gap: 12, marginTop: 8 }}>
          <LatencyTable summary={summary} caption="Answered questions this session (browser clock)" />
          <table className={styles.latencyTable}>
            <caption className="small">Latest questions</caption>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Outcome</th>
                <th scope="col">Speech → final</th>
                <th scope="col">Final → gate</th>
                <th scope="col">Gate → first token</th>
                <th scope="col">Server first token</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice(-8)
                .reverse()
                .map(({ turn, stages }, index) => (
                  <tr key={`${turn.gateAt}-${index}`}>
                    <td>{turn.trigger === 'manual' ? 'Manual' : turn.category}</td>
                    <td>{OUTCOME_LABEL[turn.outcome]}</td>
                    <td>{ms(stages.speech_to_final)}</td>
                    <td>{ms(stages.final_to_gate)}</td>
                    <td>{ms(stages.gate_to_first_token)}</td>
                    <td>{ms(turn.serverTtftMs)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
