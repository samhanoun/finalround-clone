'use client';

import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { useState, useEffect } from 'react';

interface FunnelStage {
  name: string;
  value: number;
  conversionRate: number;
  dropOff: number;
}

interface FunnelData {
  stages: FunnelStage[];
  period: { start: string; end: string };
  totalUsers: number;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function FunnelVisualization() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchFunnelData() {
      try {
        const res = await fetch('/api/analytics/funnel');
        if (!res.ok) throw new Error('Failed to fetch funnel data');
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    fetchFunnelData();
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small">Loading funnel data...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small error">Failed to load funnel data</p>
        </div>
      </div>
    );
  }

  const chartData = data.stages.map(stage => ({
    name: stage.name,
    users: stage.value,
    conversion: stage.conversionRate,
    dropOff: stage.dropOff,
  }));

  const formatNumber = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="cardTitle">Conversion Funnel</h2>
          <span className="badge">{data.totalUsers.toLocaleString()} total users</span>
        </div>

        <p className="small help">
          Period: {new Date(data.period.start).toLocaleDateString()} — {new Date(data.period.end).toLocaleDateString()}
        </p>

        <div className="funnel-chart">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tickFormatter={formatNumber} />
              <YAxis dataKey="name" type="category" width={100} />
              <Tooltip 
                formatter={(value: number) => [value.toLocaleString(), 'Users']}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
              />
              <Bar dataKey="users" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="funnel-stages">
          {data.stages.map((stage, index) => (
            <div key={stage.name} className="funnel-stage">
              <div className="stage-header">
                <span className="stage-number">{index + 1}</span>
                <span className="stage-name">{stage.name}</span>
              </div>
              <div className="stage-stats">
                <div className="stage-value">{stage.value.toLocaleString()}</div>
                {index > 0 && (
                  <div className="stage-conversion">
                    <span className="conversion-rate">{stage.conversionRate.toFixed(1)}%</span>
                    <span className="drop-off">({stage.dropOff > 0 ? `-${stage.dropOff.toFixed(1)}%` : '0%'} drop-off)</span>
                  </div>
                )}
              </div>
              {index < data.stages.length - 1 && (
                <div className="stage-arrow">↓</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .funnel-chart {
          margin: 16px 0;
        }
        
        .funnel-stages {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .funnel-stage {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: var(--color-bg-subtle, #f8f9fa);
          border-radius: 8px;
          position: relative;
        }
        
        .stage-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .stage-number {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #3b82f6;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 600;
        }
        
        .stage-name {
          font-weight: 500;
        }
        
        .stage-stats {
          text-align: right;
        }
        
        .stage-value {
          font-size: 1.25rem;
          font-weight: 600;
        }
        
        .stage-conversion {
          display: flex;
          gap: 8px;
          font-size: 0.75rem;
        }
        
        .conversion-rate {
          color: #10b981;
          font-weight: 500;
        }
        
        .drop-off {
          color: #ef4444;
        }
        
        .stage-arrow {
          position: absolute;
          bottom: -14px;
          left: 50%;
          transform: translateX(-50%);
          color: #9ca3af;
          font-size: 0.875rem;
        }
        
        .badge {
          background: #e0e7ff;
          color: #3730a3;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 500;
        }
        
        .error {
          color: #ef4444;
        }
      `}</style>
    </div>
  );
}
