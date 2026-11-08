import { useTranslations } from 'next-intl';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { JobsClient } from '@/components/JobsClient';

export default function JobsPage() {
  const tPage = useTranslations('PageTitles');
  return (
    <AppShell title={tPage('jobs')}>
      <RequireAuth>
        <JobsClient />
      </RequireAuth>
    </AppShell>
  );
}
