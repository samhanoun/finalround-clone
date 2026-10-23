'use client';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { FunnelVisualization } from '@/components/analytics/FunnelVisualization';
import { ExportButton } from '@/components/analytics/ExportButton';

export default function FunnelPage() {
  return (
    <AppShell title="Analytics">
      <div className="stack">
        <p className="help">
          Analyze your conversion funnel from sign-up to paid conversion.
        </p>

        <AnalyticsNav />

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
        .export-section {
          background: var(--deck);
          border: 1px solid var(--color-border, var(--line));
          border-radius: 8px;
          padding: 20px;
          margin-top: 20px;
        }
      `}</style>
    </AppShell>
  );
}
