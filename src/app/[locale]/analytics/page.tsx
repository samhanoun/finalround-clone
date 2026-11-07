'use client';
import { useTranslations } from 'next-intl';

import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { CustomDashboard } from '@/components/analytics/CustomDashboard';
import { AnalyticsReconciliation } from '@/components/AnalyticsReconciliation';

export default function AnalyticsPage() {
  const tPage = useTranslations('PageTitles');
  return (
    <AppShell title={tPage('analytics')}>
      <div className="stack">
        <p className="help">{tPage('analyticsIntro')}</p>

        <AnalyticsNav />

        {/* Exports its own CSV and PDF. */}
        <CustomDashboard />

        <details className="data-checks card">
          <summary className="cardTitle">{tPage('dataChecks')}</summary>
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
