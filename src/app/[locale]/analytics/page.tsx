'use client';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { CustomDashboard } from '@/components/analytics/CustomDashboard';
import { FunnelVisualization } from '@/components/analytics/FunnelVisualization';
import { CohortAnalysis } from '@/components/analytics/CohortAnalysis';
import { ExportButton } from '@/components/analytics/ExportButton';
import { ScheduledReports } from '@/components/analytics/ScheduledReports';
import { AnalyticsReconciliation } from '@/components/AnalyticsReconciliation';

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics">
      <div className="stack">
        <p className="help">
          Track your interview preparation progress and conversion metrics.
        </p>

        <AnalyticsNav />

        <CustomDashboard />

        <div id="funnel-export">
          <FunnelVisualization />
        </div>

        <CohortAnalysis />

        <ScheduledReports />

        <div className="export-section card">
          <h2 className="cardTitle">Export data</h2>
          <p className="small help">
            Download your analytics as CSV.
          </p>
          <div className="export-buttons">
            <ExportButton 
              filename="funnel-analytics"
              elementId="funnel-export"
              label="Export Funnel"
            />
          </div>
        </div>

        <details className="data-checks card">
          <summary className="cardTitle">Data checks</summary>
          <AnalyticsReconciliation />
        </details>
      </div>

      <style jsx>{`
        .export-section {
          padding: 20px 24px;
        }

        .export-buttons {
          margin-top: 12px;
        }

        .data-checks {
          padding: 18px 24px;
        }

        .data-checks > summary {
          cursor: pointer;
        }
      `}</style>
    </AppShell>
  );
}
