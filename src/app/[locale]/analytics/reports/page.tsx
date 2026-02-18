'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { ScheduledReports } from '@/components/analytics/ScheduledReports';

export default function ReportsPage() {
  return (
    <AppShell title="Scheduled Reports">
      <RequireAuth>
        <div className="stack">
          <p className="help">
            Schedule automated email reports to stay updated on your analytics.
          </p>

          <div className="analytics-nav">
            <Link href="/analytics" className="nav-link">
              📊 Overview
            </Link>
            <Link href="/analytics/funnel" className="nav-link">
              🔻 Funnel
            </Link>
            <Link href="/analytics/cohort" className="nav-link">
              📈 Cohort
            </Link>
            <Link href="/analytics/reports" className="nav-link active">
              📧 Reports
            </Link>
          </div>

          <ScheduledReports />
        </div>
      </RequireAuth>

      <style jsx>{`
        .analytics-nav {
          display: flex;
          gap: 8px;
          padding: 12px 0;
          border-bottom: 1px solid var(--color-border, #e5e7eb);
          margin-bottom: 20px;
          overflow-x: auto;
        }
        
        .nav-link {
          padding: 8px 16px;
          border-radius: 6px;
          text-decoration: none;
          color: #6b7280;
          font-size: 0.875rem;
          font-weight: 500;
          white-space: nowrap;
          transition: all 0.2s;
        }
        
        .nav-link:hover {
          background: #f3f4f6;
          color: #1f2937;
        }
        
        .nav-link.active {
          background: #e0e7ff;
          color: #3730a3;
        }
      `}</style>
    </AppShell>
  );
}
