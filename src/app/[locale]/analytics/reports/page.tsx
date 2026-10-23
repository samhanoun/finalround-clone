'use client';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { RequireAuth } from '@/components/RequireAuth';
import { ScheduledReports } from '@/components/analytics/ScheduledReports';

export default function ReportsPage() {
  return (
    <AppShell title="Analytics">
      <RequireAuth>
        <div className="stack">
          <p className="help">
            Schedule automated email reports to stay updated on your analytics.
          </p>

          <AnalyticsNav />

          <ScheduledReports />
        </div>
      </RequireAuth>

      <style jsx>{`
      `}</style>
    </AppShell>
  );
}
