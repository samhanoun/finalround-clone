import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { AnalyticsNav } from '@/components/analytics/AnalyticsNav';
import { CustomDashboard } from '@/components/analytics/CustomDashboard';
import { AnalyticsReconciliation } from '@/components/AnalyticsReconciliation';

/**
 * Analytics → Overview. The data checks (totals reconciled against raw
 * events) are a support tool, so they only show with ?debug=1.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tPage = await getTranslations('PageTitles');
  const { debug } = await searchParams;

  return (
    <AppShell title={tPage('analytics')}>
      <div className="stack">
        <AnalyticsNav />

        {/* Exports its own CSV and PDF. */}
        <CustomDashboard intro={tPage('analyticsIntro')} />

        {debug === '1' ? (
          <section aria-label={tPage('dataChecks')}>
            <AnalyticsReconciliation />
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
