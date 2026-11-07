import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { SupportCenter } from '@/components/support/SupportCenter';

export default async function SupportPage() {
  const t = await getTranslations('Support');
  return (
    <AppShell title={t('title')}>
      <RequireAuth>
        <SupportCenter />
      </RequireAuth>
    </AppShell>
  );
}
