'use client';
import { useTranslations } from 'next-intl';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { RequireAuth } from '@/components/RequireAuth';
import { WeeklyActivity } from '@/components/analytics/WeeklyActivity';

export default function WeeklyPage() {
  const tPage = useTranslations('PageTitles');
  return (
    <AppShell title={tPage('analytics')}>
      <RequireAuth>
        <div className="stack">
          <AnalyticsNav />
          <WeeklyActivity />
        </div>
      </RequireAuth>
    </AppShell>
  );
}
