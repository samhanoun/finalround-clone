'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import {
  LATENCY_STAGES,
  STAGE_TARGETS,
  stageDurations,
  summarizeStages,
  type LatencyStage,
  type LatencySummary,
  type StageSummary,
} from '@/lib/copilot/latency';
import type { CopilotAnswers } from './useCopilotAnswers';
import styles from '../LiveCopilotClient.module.css';

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
  const t = useTranslations('Latency');
  return (
    <table className={styles.latencyTable}>
      <caption className="small">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t('stage')}</th>
          <th scope="col">p50</th>
          <th scope="col">p95</th>
          <th scope="col">{t('samples')}</th>
          <th scope="col">{t('target')}</th>
        </tr>
      </thead>
      <tbody>
        {LATENCY_STAGES.map((stage) => (
          <tr key={stage} className={overTarget(stage, summary[stage]) ? styles.latencyOver : undefined}>
            <th scope="row">{t(`stages.${stage}`)}</th>
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
  const t = useTranslations('Latency');
  const tAnswer = useTranslations('Answer');
  const turns = useSyncExternalStore(answers.subscribeTurns, answers.getTurns, answers.getTurns);
  const rows = useMemo(() => turns.map((turn) => ({ turn, stages: stageDurations(turn) })), [turns]);
  const summary = useMemo(
    () => summarizeStages(rows.filter((row) => row.turn.outcome === 'answered').map((row) => row.stages)),
    [rows],
  );

  return (
    <details className={styles.settingsCard}>
      <summary className="small" style={{ cursor: 'pointer' }}>
        {t.rich('summary', { count: turns.length, strong: (chunks) => <strong>{chunks}</strong> })}
        {summary.speech_to_first_token.p50 !== null ? ` · ${t('summaryP50', { time: ms(summary.speech_to_first_token.p50) })}` : ''}
      </summary>

      {turns.length === 0 ? (
        <p className="small" style={{ margin: '8px 0 0' }}>
          {t('empty')}
        </p>
      ) : (
        <div className="stack" style={{ gap: 12, marginTop: 8 }}>
          <LatencyTable summary={summary} caption={t('answeredCaption')} />
          <table className={styles.latencyTable}>
            <caption className="small">{t('latestCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('type')}</th>
                <th scope="col">{t('outcome')}</th>
                <th scope="col">{t('stages.speech_to_final')}</th>
                <th scope="col">{t('stages.final_to_gate')}</th>
                <th scope="col">{t('stages.gate_to_first_token')}</th>
                <th scope="col">{t('serverFirstToken')}</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice(-8)
                .reverse()
                .map(({ turn, stages }, index) => (
                  <tr key={`${turn.gateAt}-${index}`}>
                    <td>
                      {turn.trigger === 'manual'
                        ? t('manual')
                        : tAnswer.has(`category.${turn.category}`)
                          ? tAnswer(`category.${turn.category}`)
                          : turn.category}
                    </td>
                    <td>{t(`outcomes.${turn.outcome}`)}</td>
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
