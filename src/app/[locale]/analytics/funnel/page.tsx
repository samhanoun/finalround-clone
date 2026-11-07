'use client';
import { useTranslations } from 'next-intl';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { RequireAuth } from '@/components/RequireAuth';
import { FunnelVisualization } from '@/components/analytics/FunnelVisualization';

export default function FunnelPage() {
  const tPage = useTranslations('PageTitles');
  return (
    <AppShell title={tPage('analytics')}>
      <RequireAuth>
        <div className="stack">
          <AnalyticsNav />
          <FunnelVisualization />
        </div>
      </RequireAuth>
    </AppShell>
  );
}
