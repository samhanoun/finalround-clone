'use client';

import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend
} from 'recharts';
import { useState, useEffect } from 'react';

interface CohortData {
  cohortDate: string;
  cohortSize: number;
  retention: number[];
  period: string;
}

interface CohortAnalysisData {
  cohorts: CohortData[];
  averageRetention: number[];
  period: { start: string; end: string };
}

export function CohortAnalysis() {
  const [data, setData] = useState<CohortAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<'retention' | 'size'>('retention');

  useEffect(() => {
    async function fetchCohortData() {
      try {
        const res = await fetch('/api/analytics/cohort');
        if (!res.ok) throw new Error('Failed to fetch cohort data');
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    fetchCohortData();
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small">Loading cohort data...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small error">Failed to load cohort data</p>
        </div>
      </div>
    );
  }

  const weeks = data.cohorts[0]?.retention.length || 4;
  const weekLabels = Array.from({ length: weeks }, (_, i) => `Week ${i + 1}`);

  // Prepare chart data for retention trends
  const trendData = data.cohorts.map(cohort => ({
    name: cohort.cohortDate,
    ...cohort.retention.reduce((acc, val, idx) => {
      acc[`Week${idx + 1}`] = val;
      return acc;
    }, {} as Record<string, number>),
  }));

  // Prepare data for heatmap-style table
  const tableData = data.cohorts.map(cohort => ({
    cohort: cohort.cohortDate,
    size: cohort.cohortSize,
    retention: cohort.retention,
  }));

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="cardTitle">Cohort Analysis</h2>
          <div className="metric-toggle">
            <button 
              className={`toggle-btn ${selectedMetric === 'retention' ? 'active' : ''}`}
              onClick={() => setSelectedMetric('retention')}
            >
              Retention
            </button>
            <button 
              className={`toggle-btn ${selectedMetric === 'size' ? 'active' : ''}`}
              onClick={() => setSelectedMetric('size')}
            >
              Cohort Size
            </button>
          </div>
        </div>

        <p className="small help">
          Period: {new Date(data.period.start).toLocaleDateString()} — {new Date(data.period.end).toLocaleDateString()}
        </p>

        <div className="cohort-summary">
          <div className="summary-item">
            <span className="summary-value">{data.cohorts.length}</span>
            <span className="summary-label">Total Cohorts</span>
          </div>
          <div className="summary-item">
            <span className="summary-value">{data.cohorts.reduce((a, c) => a + c.cohortSize, 0).toLocaleString()}</span>
            <span className="summary-label">Total Users</span>
          </div>
          <div className="summary-item">
            <span className="summary-value">{data.averageRetention[3]?.toFixed(1) || 0}%</span>
            <span className="summary-label">Week 4 Avg Retention</span>
          </div>
        </div>

        <div className="cohort-chart">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trendData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Retention']} />
              <Legend />
              {weekLabels.slice(0, 5).map((label, idx) => (
                <Line 
                  key={label}
                  type="monotone" 
                  dataKey={`Week${idx + 1}`} 
                  stroke={colors[idx % colors.length]} 
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="cohort-table-wrapper">
          <table className="cohort-table">
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Users</th>
                {weekLabels.map((label, idx) => (
                  <th key={idx}>W{idx + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.map((row, rowIdx) => (
                <tr key={row.cohort}>
                  <td className="cohort-date">{row.cohort}</td>
                  <td className="cohort-size">{row.size.toLocaleString()}</td>
                  {row.retention.map((val, colIdx) => {
                    const bgColor = `rgba(59, 130, 246, ${val / 100})`;
                    return (
                      <td 
                        key={colIdx} 
                        className="retention-cell"
                        style={{ backgroundColor: val > 0 ? bgColor : 'transparent' }}
                      >
                        {val > 0 ? `${val.toFixed(0)}%` : '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx>{`
        .cohort-summary {
          display: flex;
          gap: 24px;
          padding: 16px;
          background: var(--color-bg-subtle, #f8f9fa);
          border-radius: 8px;
          margin-bottom: 16px;
        }
        
        .summary-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
        }
        
        .summary-value {
          font-size: 1.5rem;
          font-weight: 600;
          color: #3b82f6;
        }
        
        .summary-label {
          font-size: 0.75rem;
          color: #6b7280;
        }
        
        .cohort-chart {
          margin: 16px 0;
        }
        
        .cohort-table-wrapper {
          overflow-x: auto;
          margin-top: 16px;
        }
        
        .cohort-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
        }
        
        .cohort-table th,
        .cohort-table td {
          padding: 8px 12px;
          text-align: center;
          border: 1px solid #e5e7eb;
        }
        
        .cohort-table th {
          background: #f8f9fa;
          font-weight: 600;
        }
        
        .cohort-date {
          font-weight: 500;
          text-align: left !important;
        }
        
        .cohort-size {
          color: #6b7280;
        }
        
        .retention-cell {
          color: #1f2937;
          font-weight: 500;
        }
        
        .metric-toggle {
          display: flex;
          gap: 4px;
          background: #f3f4f6;
          padding: 4px;
          border-radius: 6px;
        }
        
        .toggle-btn {
          padding: 6px 12px;
          border: none;
          background: transparent;
          border-radius: 4px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .toggle-btn.active {
          background: white;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        .error {
          color: #ef4444;
        }
      `}</style>
    </div>
  );
}
