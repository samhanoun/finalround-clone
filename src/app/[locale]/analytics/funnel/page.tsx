'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { FunnelVisualization } from '@/components/analytics/FunnelVisualization';
import { ExportButton } from '@/components/analytics/ExportButton';

export default function FunnelPage() {
  return (
    <AppShell title="Funnel Analytics">
      <div className="stack">
        <p className="help">
          Analyze your conversion funnel from sign-up to paid conversion.
        </p>

        <div className="analytics-nav">
          <Link href="/analytics" className="nav-link">
            📊 Overview
          </Link>
          <Link href="/analytics/funnel" className="nav-link active">
            🔻 Funnel
          </Link>
          <Link href="/analytics/cohort" className="nav-link">
            📈 Cohort
          </Link>
          <Link href="/analytics/reports" className="nav-link">
            📧 Reports
          </Link>
        </div>

        <div id="funnel-detail">
          <FunnelVisualization />
        </div>

        <div className="export-section">
          <h2 className="cardTitle">Export Funnel Data</h2>
          <p className="small help">
            Download funnel metrics for external analysis.
          </p>
          <ExportButton 
            filename="funnel-detail"
            elementId="funnel-detail"
            label="Export Funnel"
          />
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
          margin-top: 20px;
        }
      `}</style>
    </AppShell>
  );
}
