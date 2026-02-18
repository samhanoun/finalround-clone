'use client';

import { useState, useEffect } from 'react';

interface ScheduledReport {
  id: string;
  report_type: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  email: string;
  enabled: boolean;
  last_sent: string | null;
  next_send: string;
}

export function ScheduledReports() {
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    report_type: 'weekly',
    frequency: 'weekly',
    email: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchReports();
  }, []);

  async function fetchReports() {
    try {
      const res = await fetch('/api/analytics/reports');
      if (!res.ok) throw new Error('Failed to fetch reports');
      const data = await res.json();
      setReports(data.reports || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateReport(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    
    try {
      const res = await fetch('/api/analytics/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      if (!res.ok) throw new Error('Failed to create report');
      
      const data = await res.json();
      setReports([...reports, data.report]);
      setShowForm(false);
      setFormData({ report_type: 'weekly', frequency: 'weekly', email: '' });
    } catch (e) {
      alert('Failed to create report');
    } finally {
      setSaving(false);
    }
  }

  async function toggleReport(id: string, enabled: boolean) {
    try {
      await fetch('/api/analytics/reports', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled: !enabled }),
      });
      
      setReports(reports.map(r => 
        r.id === id ? { ...r, enabled: !enabled } : r
      ));
    } catch (e) {
      alert('Failed to update report');
    }
  }

  async function deleteReport(id: string) {
    if (!confirm('Are you sure you want to delete this report?')) return;
    
    try {
      await fetch(`/api/analytics/reports?id=${id}`, { method: 'DELETE' });
      setReports(reports.filter(r => r.id !== id));
    } catch (e) {
      alert('Failed to delete report');
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small">Loading reports...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="cardTitle">Scheduled Email Reports</h2>
          <button 
            className="button buttonPrimary"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? 'Cancel' : '+ New Report'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreateReport} className="report-form">
            <div className="form-row">
              <div className="form-group">
                <label>Report Type</label>
                <select 
                  value={formData.report_type}
                  onChange={(e) => setFormData({ ...formData, report_type: e.target.value })}
                >
                  <option value="funnel">Funnel Analysis</option>
                  <option value="cohort">Cohort Retention</option>
                  <option value="sessions">Session Stats</option>
                  <option value="full">Full Report</option>
                </select>
              </div>
              <div className="form-group">
                <label>Frequency</label>
                <select 
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="form-group">
                <label>Email</label>
                <input 
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="your@email.com"
                  required
                />
              </div>
              <button 
                type="submit" 
                className="button buttonPrimary"
                disabled={saving}
              >
                {saving ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        )}

        <div className="reports-list">
          {reports.length === 0 ? (
            <p className="small help">No scheduled reports yet. Create one to receive analytics via email.</p>
          ) : (
            reports.map((report) => (
              <div key={report.id} className="report-item">
                <div className="report-info">
                  <div className="report-type">
                    <span className="report-badge">{report.report_type}</span>
                    <span className="report-frequency">{report.frequency}</span>
                  </div>
                  <div className="report-email">{report.email}</div>
                  <div className="report-dates">
                    <span>Last sent: {formatDate(report.last_sent)}</span>
                    <span>Next: {formatDate(report.next_send)}</span>
                  </div>
                </div>
                <div className="report-actions">
                  <label className="toggle">
                    <input 
                      type="checkbox"
                      checked={report.enabled}
                      onChange={() => toggleReport(report.id, report.enabled)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <button 
                    className="delete-btn"
                    onClick={() => deleteReport(report.id)}
                    title="Delete report"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .report-form {
          background: #f9fafb;
          padding: 16px;
          border-radius: 8px;
          margin-bottom: 16px;
        }
        
        .form-row {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-width: 150px;
        }
        
        .form-group label {
          font-size: 0.75rem;
          font-weight: 500;
          color: #6b7280;
        }
        
        .form-group select,
        .form-group input {
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 0.875rem;
        }
        
        .reports-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .report-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: #f9fafb;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }
        
        .report-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .report-type {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .report-badge {
          background: #e0e7ff;
          color: #3730a3;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: capitalize;
        }
        
        .report-frequency {
          font-size: 0.75rem;
          color: #6b7280;
          text-transform: capitalize;
        }
        
        .report-email {
          font-size: 0.875rem;
          font-weight: 500;
        }
        
        .report-dates {
          display: flex;
          gap: 16px;
          font-size: 0.7rem;
          color: #9ca3af;
        }
        
        .report-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .toggle {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        
        .toggle input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        
        .toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #d1d5db;
          transition: 0.3s;
          border-radius: 24px;
        }
        
        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        
        .toggle input:checked + .toggle-slider {
          background-color: #10b981;
        }
        
        .toggle input:checked + .toggle-slider:before {
          transform: translateX(20px);
        }
        
        .delete-btn {
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px;
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        
        .delete-btn:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
