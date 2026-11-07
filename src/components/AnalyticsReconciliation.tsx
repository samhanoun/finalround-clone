'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

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

const STATUS_MARK = { consistent: '✓', warning: '⚠', critical: '✕' } as const;

function StatusBadge({ status }: { status: 'consistent' | 'warning' | 'critical' }) {
  const t = useTranslations('DataChecks');
  return (
    <span className={`status-badge status-${status}`}>
      {STATUS_MARK[status]} {t(`status.${status}`)}
    </span>
  );
}

function MetricRow({ metric }: { metric: MetricReconciliation }) {
  const t = useTranslations('DataChecks');
  const format = useFormatter();
  const percentDiff = Math.abs(metric.differencePercent * 100).toFixed(1);
  const diffDisplay = metric.difference >= 0 ? `+${metric.difference}` : `${metric.difference}`;

  return (
    <div className={`metric-row metric-${metric.status}`}>
      <div className="metric-name">{metric.metricName}</div>
      <div className="metric-values">
        <div className="metric-actual">
          <span className="metric-label">{t('actual')}</span>
          <span className="metric-value">{format.number(metric.rawEventCount)}</span>
        </div>
        <div className="metric-expected">
          <span className="metric-label">{t('expected')}</span>
          <span className="metric-value">{format.number(metric.aggregatedCount)}</span>
        </div>
        <div className="metric-diff">
          <span className="metric-label">{t('difference')}</span>
          <span className={`metric-value ${metric.difference >= 0 ? 'positive' : 'negative'}`}>
            {diffDisplay} ({percentDiff}%)
          </span>
        </div>
      </div>
      <div className="metric-status">
        <StatusBadge status={metric.status} />
      </div>
    </div>
  );
}

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

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small error">{t('failed')}</p>
        </div>
      </div>
    );
  }

  const overallMark = { healthy: '✓', warning: '⚠', critical: '✕' }[data.overallStatus];
  const overallLabel = `${overallMark} ${t(`overall.${data.overallStatus}`)}`;
  const overallClass = `overall-${data.overallStatus}`;

  const formatDate = (dateStr: string) => format.dateTime(new Date(dateStr), { dateStyle: 'medium' });

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="cardTitle">{t('title')}</h2>
          <span className={`overall-badge ${overallClass}`}>
            {overallLabel}
          </span>
        </div>

        <div className="reconciliation-info">
          <p className="small help">
            {t('period', { start: formatDate(data.period.start), end: formatDate(data.period.end) })}
            {' • '}
            {t('lastChecked', { time: format.dateTime(new Date(data.lastChecked), { timeStyle: 'medium' }) })}
          </p>
        </div>

        <div className="summary-stats">
          <div className="stat-item">
            <span className="stat-value">{data.summary.totalMetrics}</span>
            <span className="stat-label">{t('total')}</span>
          </div>
          <div className="stat-item stat-consistent">
            <span className="stat-value">{data.summary.withinTolerance}</span>
            <span className="stat-label">{t('within')}</span>
          </div>
          <div className="stat-item stat-warning">
            <span className="stat-value">{data.summary.outsideTolerance}</span>
            <span className="stat-label">{t('outside')}</span>
          </div>
        </div>

        <div className="metrics-list">
          <div className="metrics-header">
            <span>{t('metric')}</span>
            <span>{t('values')}</span>
            <span>{t('statusHeader')}</span>
          </div>
          {data.metrics.map((metric, index) => (
            <MetricRow key={index} metric={metric} />
          ))}
        </div>

        <p className="small help">
          {t('note')}{' '}
          {data.overallStatus !== 'healthy' && <span className="error">{t('investigate')}</span>}
        </p>
      </div>

      <style jsx>{`
        .reconciliation-info {
          padding: 8px 12px;
          background: var(--color-bg-subtle, var(--well));
          border-radius: 6px;
        }

        .summary-stats {
          display: flex;
          gap: 16px;
          padding: 12px;
          background: var(--color-bg-subtle, var(--well));
          border-radius: 8px;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          padding: 8px;
        }

        .stat-value {
          font-size: 1.5rem;
          font-weight: 600;
        }

        .stat-label {
          font-size: 0.75rem;
          color: var(--color-text-muted, var(--mist));
        }

        .stat-consistent .stat-value {
          color: var(--live);
        }

        .stat-warning .stat-value {
          color: var(--caution);
        }

        .metrics-list {
          border: 1px solid var(--color-border, var(--line));
          border-radius: 8px;
          overflow: hidden;
        }

        .metrics-header {
          display: grid;
          grid-template-columns: 1fr 2fr 120px;
          gap: 12px;
          padding: 12px 16px;
          background: var(--color-bg-subtle, var(--well));
          font-weight: 600;
          font-size: 0.875rem;
          border-bottom: 1px solid var(--color-border, var(--line));
        }

        .metric-row {
          display: grid;
          grid-template-columns: 1fr 2fr 120px;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border, var(--line));
          align-items: center;
        }

        .metric-row:last-child {
          border-bottom: none;
        }

        .metric-row.metric-consistent {
          background: rgba(69, 212, 155, 0.05);
        }

        .metric-row.metric-warning {
          background: rgba(247, 195, 95, 0.05);
        }

        .metric-row.metric-critical {
          background: rgba(255, 107, 107, 0.05);
        }

        .metric-name {
          font-weight: 500;
        }

        .metric-values {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }

        .metric-actual,
        .metric-expected,
        .metric-diff {
          display: flex;
          flex-direction: column;
        }

        .metric-label {
          font-size: 0.7rem;
          color: var(--color-text-muted, var(--mist));
        }

        .metric-value {
          font-weight: 500;
          font-family: monospace;
        }

        .metric-value.positive {
          color: var(--live);
        }

        .metric-value.negative {
          color: var(--alert);
        }

        .status-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .status-consistent {
          background: rgba(69, 212, 155, 0.1);
          color: var(--live);
        }

        .status-warning {
          background: rgba(247, 195, 95, 0.1);
          color: var(--caution);
        }

        .status-critical {
          background: rgba(255, 107, 107, 0.1);
          color: var(--alert);
        }

        .overall-badge {
          padding: 6px 12px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.875rem;
        }

        .overall-healthy {
          background: rgba(69, 212, 155, 0.1);
          color: var(--live);
        }

        .overall-warning {
          background: rgba(247, 195, 95, 0.1);
          color: var(--caution);
        }

        .overall-critical {
          background: rgba(255, 107, 107, 0.1);
          color: var(--alert);
        }

        .error {
          color: var(--alert);
        }
      `}</style>
    </div>
  );
}
