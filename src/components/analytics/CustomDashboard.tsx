'use client';

import { useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts';

interface DashboardMetric {
  id: string;
  name: string;
  value: number;
  change: number;
  changeType: 'positive' | 'negative' | 'neutral';
  format: 'number' | 'percent' | 'currency';
}

interface TimeSeriesPoint {
  date: string;
  value: number;
}

interface CustomDashboardProps {
  metrics?: DashboardMetric[];
  timeSeriesData?: TimeSeriesPoint[];
  title?: string;
}

const DEFAULT_METRICS: DashboardMetric[] = [
  { id: '1', name: 'Total Users', value: 1250, change: 12.5, changeType: 'positive', format: 'number' },
  { id: '2', name: 'Active Users', value: 890, change: 8.3, changeType: 'positive', format: 'number' },
  { id: '3', name: 'Interview Sessions', value: 3420, change: 15.2, changeType: 'positive', format: 'number' },
  { id: '4', name: 'Conversion Rate', value: 4.2, change: -0.8, changeType: 'negative', format: 'percent' },
  { id: '5', name: 'Avg Session Duration', value: 28.5, change: 5.1, changeType: 'positive', format: 'number' },
  { id: '6', name: 'Retention (Week 4)', value: 42, change: 3.2, changeType: 'positive', format: 'percent' },
];

const TIME_SERIES_DATA: TimeSeriesPoint[] = [
  { date: '2024-01', value: 800 },
  { date: '2024-02', value: 920 },
  { date: '2024-03', value: 1050 },
  { date: '2024-04', value: 1180 },
  { date: '2024-05', value: 1250 },
  { date: '2024-06', value: 1320 },
];

const PIE_DATA = [
  { name: 'Free Users', value: 1120 },
  { name: 'Basic Plan', value: 85 },
  { name: 'Pro Plan', value: 35 },
  { name: 'Enterprise', value: 10 },
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export function CustomDashboard({ 
  metrics = DEFAULT_METRICS,
  timeSeriesData = TIME_SERIES_DATA,
  title = 'Analytics Overview'
}: CustomDashboardProps) {
  const [selectedRange, setSelectedRange] = useState<'week' | 'month' | 'quarter'>('month');
  const [selectedChart, setSelectedChart] = useState<'line' | 'bar' | 'area'>('line');

  const formatValue = (value: number, format: DashboardMetric['format']) => {
    switch (format) {
      case 'percent':
        return `${value}%`;
      case 'currency':
        return `$${value.toLocaleString()}`;
      default:
        return value.toLocaleString();
    }
  };

  const getChangeIcon = (type: DashboardMetric['changeType']) => {
    switch (type) {
      case 'positive':
        return '↑';
      case 'negative':
        return '↓';
      default:
        return '→';
    }
  };

  return (
    <div className="custom-dashboard">
      <div className="dashboard-header">
        <h2 className="cardTitle">{title}</h2>
        <div className="dashboard-controls">
          <div className="range-selector">
            <button 
              className={selectedRange === 'week' ? 'active' : ''}
              onClick={() => setSelectedRange('week')}
            >
              Week
            </button>
            <button 
              className={selectedRange === 'month' ? 'active' : ''}
              onClick={() => setSelectedRange('month')}
            >
              Month
            </button>
            <button 
              className={selectedRange === 'quarter' ? 'active' : ''}
              onClick={() => setSelectedRange('quarter')}
            >
              Quarter
            </button>
          </div>
        </div>
      </div>

      <div className="metrics-grid">
        {metrics.map((metric) => (
          <div key={metric.id} className="metric-card">
            <div className="metric-name">{metric.name}</div>
            <div className="metric-value">
              {formatValue(metric.value, metric.format)}
            </div>
            <div className={`metric-change ${metric.changeType}`}>
              <span className="change-icon">{getChangeIcon(metric.changeType)}</span>
              <span className="change-value">{Math.abs(metric.change)}%</span>
              <span className="change-period">vs last period</span>
            </div>
          </div>
        ))}
      </div>

      <div className="charts-section">
        <div className="chart-container main-chart">
          <div className="chart-header">
            <h3>Growth Trends</h3>
            <div className="chart-type-selector">
              <button 
                className={selectedChart === 'line' ? 'active' : ''}
                onClick={() => setSelectedChart('line')}
              >
                Line
              </button>
              <button 
                className={selectedChart === 'bar' ? 'active' : ''}
                onClick={() => setSelectedChart('bar')}
              >
                Bar
              </button>
              <button 
                className={selectedChart === 'area' ? 'active' : ''}
                onClick={() => setSelectedChart('area')}
              >
                Area
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            {selectedChart === 'line' ? (
              <LineChart data={timeSeriesData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="users" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name="Users" />
                <Line yAxisId="left" type="monotone" dataKey="sessions" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Sessions" />
                <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="Revenue" />
              </LineChart>
            ) : selectedChart === 'bar' ? (
              <BarChart data={timeSeriesData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} />
                <Legend />
                <Bar dataKey="users" fill="#3b82f6" name="Users" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sessions" fill="#10b981" name="Sessions" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <AreaChart data={timeSeriesData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }} />
                <Legend />
                <Area type="monotone" dataKey="users" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} name="Users" />
                <Area type="monotone" dataKey="sessions" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="Sessions" />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>

        <div className="chart-container side-chart">
          <h3>User Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={PIE_DATA}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
              >
                {PIE_DATA.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <style jsx>{`
        .dashboard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .dashboard-controls {
          display: flex;
          gap: 12px;
        }
        
        .range-selector {
          display: flex;
          gap: 4px;
          background: #f3f4f6;
          padding: 4px;
          border-radius: 6px;
        }
        
        .range-selector button {
          padding: 6px 12px;
          border: none;
          background: transparent;
          border-radius: 4px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .range-selector button.active {
          background: white;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        
        .metric-card {
          background: var(--color-bg-subtle, #f8f9fa);
          padding: 16px;
          border-radius: 8px;
          border: 1px solid var(--color-border, #e5e7eb);
        }
        
        .metric-name {
          font-size: 0.75rem;
          color: #6b7280;
          margin-bottom: 4px;
        }
        
        .metric-value {
          font-size: 1.5rem;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 4px;
        }
        
        .metric-change {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 0.75rem;
        }
        
        .metric-change.positive {
          color: #10b981;
        }
        
        .metric-change.negative {
          color: #ef4444;
        }
        
        .metric-change.neutral {
          color: #6b7280;
        }
        
        .change-icon {
          font-weight: 600;
        }
        
        .change-period {
          color: #9ca3af;
          margin-left: 4px;
        }
        
        .charts-section {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 20px;
        }
        
        @media (max-width: 768px) {
          .charts-section {
            grid-template-columns: 1fr;
          }
        }
        
        .chart-container {
          background: white;
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 8px;
          padding: 16px;
        }
        
        .chart-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        
        .chart-header h3 {
          font-size: 1rem;
          font-weight: 600;
          margin: 0;
        }
        
        .chart-type-selector {
          display: flex;
          gap: 4px;
        }
        
        .chart-type-selector button {
          padding: 4px 8px;
          border: 1px solid #e5e7eb;
          background: white;
          border-radius: 4px;
          font-size: 0.7rem;
          cursor: pointer;
        }
        
        .chart-type-selector button.active {
          background: #3b82f6;
          color: white;
          border-color: #3b82f6;
        }
        
        .side-chart h3 {
          font-size: 1rem;
          font-weight: 600;
          margin: 0 0 16px 0;
        }
      `}</style>
    </div>
  );
}
