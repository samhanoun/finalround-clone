'use client';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { CustomDashboard } from '@/components/analytics/CustomDashboard';
import { ScheduledReports } from '@/components/analytics/ScheduledReports';
import { AnalyticsReconciliation } from '@/components/AnalyticsReconciliation';

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics">
      <div className="stack">
        <p className="help">
          Your live sessions, practice interviews and scores over time.
        </p>

        <AnalyticsNav />

        {/* Exports its own CSV and PDF. */}
        <CustomDashboard />

        <ScheduledReports />

        <details className="data-checks card">
          <summary className="cardTitle">Data checks</summary>
          <AnalyticsReconciliation />
        </details>
      </div>

      <style jsx>{`
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
