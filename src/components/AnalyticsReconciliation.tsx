'use client';

import { useEffect, useState } from 'react';

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

function StatusBadge({ status }: { status: 'consistent' | 'warning' | 'critical' }) {
  const config = {
    consistent: { label: '✓ Consistent', className: 'status-consistent' },
    warning: { label: '⚠ Warning', className: 'status-warning' },
    critical: { label: '✕ Critical', className: 'status-critical' },
  };
  
  const { label, className } = config[status];
  
  return (
    <span className={`status-badge ${className}`}>
      {label}
    </span>
  );
}

function MetricRow({ metric }: { metric: MetricReconciliation }) {
  const percentDiff = Math.abs(metric.differencePercent * 100).toFixed(1);
  const diffDisplay = metric.difference >= 0 ? `+${metric.difference}` : `${metric.difference}`;
  
  return (
    <div className={`metric-row metric-${metric.status}`}>
      <div className="metric-name">{metric.metricName}</div>
      <div className="metric-values">
        <div className="metric-actual">
          <span className="metric-label">Actual (Events):</span>
          <span className="metric-value">{metric.rawEventCount.toLocaleString()}</span>
        </div>
        <div className="metric-expected">
          <span className="metric-label">Expected (Aggregated):</span>
          <span className="metric-value">{metric.aggregatedCount.toLocaleString()}</span>
        </div>
        <div className="metric-diff">
          <span className="metric-label">Difference:</span>
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
  const [data, setData] = useState<ReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReconciliation() {
      try {
        const res = await fetch('/api/analytics/reconciliation');
        if (!res.ok) throw new Error('Failed to fetch reconciliation data');
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
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
          <p className="small">Loading analytics reconciliation...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small error">Failed to load reconciliation data</p>
        </div>
      </div>
    );
  }

  const overallConfig = {
    healthy: { label: '✓ Data Consistent', className: 'overall-healthy' },
    warning: { label: '⚠ Some Discrepancies', className: 'overall-warning' },
    critical: { label: '✕ Data Issues Detected', className: 'overall-critical' },
  };

  const { label: overallLabel, className: overallClass } = overallConfig[data.overallStatus];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="cardTitle">Analytics Reconciliation</h2>
          <span className={`overall-badge ${overallClass}`}>
            {overallLabel}
          </span>
        </div>

        <div className="reconciliation-info">
          <p className="small help">
            Period: {formatDate(data.period.start)} — {formatDate(data.period.end)}
            {' • '}
            Last checked: {new Date(data.lastChecked).toLocaleTimeString()}
          </p>
        </div>

        <div className="summary-stats">
          <div className="stat-item">
            <span className="stat-value">{data.summary.totalMetrics}</span>
            <span className="stat-label">Total Metrics</span>
          </div>
          <div className="stat-item stat-consistent">
            <span className="stat-value">{data.summary.withinTolerance}</span>
            <span className="stat-label">Within ±1%</span>
          </div>
          <div className="stat-item stat-warning">
            <span className="stat-value">{data.summary.outsideTolerance}</span>
            <span className="stat-label">Outside Tolerance</span>
          </div>
        </div>

        <div className="metrics-list">
          <div className="metrics-header">
            <span>Metric</span>
            <span>Values</span>
            <span>Status</span>
          </div>
          {data.metrics.map((metric, index) => (
            <MetricRow key={index} metric={metric} />
          ))}
        </div>

        <p className="small help">
          Metrics reconcile with raw events within ±1% tolerance as per PRD section 13.6.
          {' '}
          {data.overallStatus !== 'healthy' && (
            <span className="error">
              Please investigate the discrepancies above.
            </span>
          )}
        </p>
      </div>

      <style jsx>{`
        .reconciliation-info {
          padding: 8px 12px;
          background: var(--color-bg-subtle, #f8f9fa);
          border-radius: 6px;
        }
        
        .summary-stats {
          display: flex;
          gap: 16px;
          padding: 12px;
          background: var(--color-bg-subtle, #f8f9fa);
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
          color: var(--color-text-muted, #666);
        }
        
        .stat-consistent .stat-value {
          color: #10b981;
        }
        
        .stat-warning .stat-value {
          color: #f59e0b;
        }
        
        .metrics-list {
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 8px;
          overflow: hidden;
        }
        
        .metrics-header {
          display: grid;
          grid-template-columns: 1fr 2fr 120px;
          gap: 12px;
          padding: 12px 16px;
          background: var(--color-bg-subtle, #f8f9fa);
          font-weight: 600;
          font-size: 0.875rem;
          border-bottom: 1px solid var(--color-border, #e5e7eb);
        }
        
        .metric-row {
          display: grid;
          grid-template-columns: 1fr 2fr 120px;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border, #e5e7eb);
          align-items: center;
        }
        
        .metric-row:last-child {
          border-bottom: none;
        }
        
        .metric-row.metric-consistent {
          background: rgba(16, 185, 129, 0.05);
        }
        
        .metric-row.metric-warning {
          background: rgba(245, 158, 11, 0.05);
        }
        
        .metric-row.metric-critical {
          background: rgba(239, 68, 68, 0.05);
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
          color: var(--color-text-muted, #666);
        }
        
        .metric-value {
          font-weight: 500;
          font-family: monospace;
        }
        
        .metric-value.positive {
          color: #10b981;
        }
        
        .metric-value.negative {
          color: #ef4444;
        }
        
        .status-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
        }
        
        .status-consistent {
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
        }
        
        .status-warning {
          background: rgba(245, 158, 11, 0.1);
          color: #f59e0b;
        }
        
        .status-critical {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
        }
        
        .overall-badge {
          padding: 6px 12px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.875rem;
        }
        
        .overall-healthy {
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
        }
        
        .overall-warning {
          background: rgba(245, 158, 11, 0.1);
          color: #f59e0b;
        }
        
        .overall-critical {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
        }
        
        .error {
          color: #ef4444;
        }
      `}</style>
    </div>
  );
}
