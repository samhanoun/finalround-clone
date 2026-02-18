'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { CustomDashboard } from '@/components/analytics/CustomDashboard';
import { FunnelVisualization } from '@/components/analytics/FunnelVisualization';
import { CohortAnalysis } from '@/components/analytics/CohortAnalysis';
import { ExportButton } from '@/components/analytics/ExportButton';
import { ScheduledReports } from '@/components/analytics/ScheduledReports';

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics">
      <div className="stack">
        <p className="help">
          Track your interview preparation progress and conversion metrics.
        </p>

        <div className="analytics-nav">
          <Link href="/analytics" className="nav-link active">
            📊 Overview
          </Link>
          <Link href="/analytics/funnel" className="nav-link">
            🔻 Funnel
          </Link>
          <Link href="/analytics/cohort" className="nav-link">
            📈 Cohort
          </Link>
          <Link href="/analytics/reports" className="nav-link">
            📧 Reports
          </Link>
        </div>

        <CustomDashboard />

        <div className="row" style={{ gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: '300px' }}>
            <div id="funnel-export">
              <FunnelVisualization />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '250px' }}>
            <CohortAnalysis />
          </div>
        </div>

        <ScheduledReports />

        <div className="export-section">
          <h2 className="cardTitle">Export Data</h2>
          <p className="small help">
            Download your analytics data in CSV format for further analysis.
          </p>
          <div className="export-buttons">
            <ExportButton 
              filename="funnel-analytics"
              elementId="funnel-export"
              label="Export Funnel"
            />
          </div>
        </div>
      </div>

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
        
        .export-section {
          background: white;
          border: 1px solid var(--color-border, #e5e7eb);
          border-radius: 8px;
          padding: 20px;
        }
        
        .export-buttons {
          margin-top: 12px;
        }
      `}</style>
    </AppShell>
  );
}
