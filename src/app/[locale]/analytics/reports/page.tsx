'use client';
import { useTranslations } from 'next-intl';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { RequireAuth } from '@/components/RequireAuth';
import { ScheduledReports } from '@/components/analytics/ScheduledReports';

export default function ReportsPage() {
  const tPage = useTranslations('PageTitles');
  return (
    <AppShell title={tPage('analytics')}>
      <RequireAuth>
        <div className="stack">
          <AnalyticsNav />

          <ScheduledReports />
        </div>
      </RequireAuth>

    </AppShell>
  );
}
