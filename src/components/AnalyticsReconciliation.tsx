'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import styles from './AnalyticsReconciliation.module.css';

interface MetricReconciliation {
  metricName: string;
  rawEventCount: number;
  aggregatedCount: number;
  difference: number;
  differencePercent: number;
  isWithinTolerance: boolean;
  status: 'consistent' | 'warning' | 'critical';
}

interface ReconciliationSummary {
  lastChecked: string;
  period: {
    start: string;
    end: string;
  };
  metrics: MetricReconciliation[];
  overallStatus: 'healthy' | 'warning' | 'critical';
  summary: {
    totalMetrics: number;
    withinTolerance: number;
    outsideTolerance: number;
  };
}

/** A status is a small dot and a word; colour only says how serious it is. */
function Status({ tone, children }: { tone: 'good' | 'warning' | 'critical'; children: React.ReactNode }) {
  return (
    <span className={styles.status} data-tone={tone}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}

const TONE = { consistent: 'good', healthy: 'good', warning: 'warning', critical: 'critical' } as const;

/**
 * Data checks: each total compared with the raw events it comes from. A
 * support tool, shown on Analytics only with ?debug=1.
 */
export function AnalyticsReconciliation() {
  const t = useTranslations('DataChecks');
  const format = useFormatter();
  const [data, setData] = useState<ReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReconciliation() {
      try {
        const res = await fetch('/api/analytics/reconciliation');
        if (!res.ok) throw new Error(`reconciliation: ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed');
      } finally {
        setLoading(false);
      }
    }
    fetchReconciliation();
  }, []);

  const formatDate = (dateStr: string) => format.dateTime(new Date(dateStr), { dateStyle: 'medium' });

  return (
    <div className="card">
      <div className={`cardInner ${styles.inner}`}>
        <div className={styles.head}>
          <h2 className="cardTitle">{t('title')}</h2>
          {data ? <Status tone={TONE[data.overallStatus]}>{t(`overall.${data.overallStatus}`)}</Status> : null}
        </div>

        {loading ? (
          <p className={styles.note}>{t('loading')}</p>
        ) : error || !data ? (
          <p className={styles.note} role="alert">
            {t('failed')}
          </p>
        ) : (
          <>
            <p className={styles.meta}>
              <span>{t('period', { start: formatDate(data.period.start), end: formatDate(data.period.end) })}</span>
              <span>{t('lastChecked', { time: format.dateTime(new Date(data.lastChecked), { timeStyle: 'medium' }) })}</span>
            </p>

            <dl className={styles.summary}>
              <div>
                <dt>{t('total')}</dt>
                <dd>{format.number(data.summary.totalMetrics)}</dd>
              </div>
              <div>
                <dt>{t('within')}</dt>
                <dd>{format.number(data.summary.withinTolerance)}</dd>
              </div>
              <div>
                <dt>{t('outside')}</dt>
                <dd>{format.number(data.summary.outsideTolerance)}</dd>
              </div>
            </dl>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">{t('metric')}</th>
                    <th scope="col">{t('actual')}</th>
                    <th scope="col">{t('expected')}</th>
                    <th scope="col">{t('difference')}</th>
                    <th scope="col">{t('statusHeader')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.metrics.map((metric) => (
                    <tr key={metric.metricName}>
                      <th scope="row">{metric.metricName}</th>
                      <td>{format.number(metric.rawEventCount)}</td>
                      <td>{format.number(metric.aggregatedCount)}</td>
                      <td>
                        {format.number(metric.difference, { signDisplay: 'exceptZero' })}{' '}
                        <span className={styles.percent}>
                          ({format.number(Math.abs(metric.differencePercent), { style: 'percent', maximumFractionDigits: 1 })})
                        </span>
                      </td>
                      <td>
                        <Status tone={TONE[metric.status]}>{t(`status.${metric.status}`)}</Status>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={styles.note}>
              {t('note')} {data.overallStatus !== 'healthy' ? t('investigate') : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
