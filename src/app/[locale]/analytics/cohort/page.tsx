'use client';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { CohortAnalysis } from '@/components/analytics/CohortAnalysis';
import { ExportButton } from '@/components/analytics/ExportButton';

export default function CohortPage() {
  return (
    <AppShell title="Analytics">
      <div className="stack">
        <p className="help">
          Track user retention and behavior patterns over time by cohort.
        </p>

        <AnalyticsNav />

        <div id="cohort-detail">
          <CohortAnalysis />
        </div>

        <div className="export-section">
          <h2 className="cardTitle">Export Cohort Data</h2>
          <p className="small help">
            Download retention data for external analysis.
          </p>
          <ExportButton 
            filename="cohort-detail"
            elementId="cohort-detail"
            label="Export Cohort"
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
