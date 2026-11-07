import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { GoalsWorkspace } from '@/components/goals/GoalsWorkspace';

export default async function GoalsPage() {
  const t = await getTranslations('Goals');
  return (
    <AppShell title={t('title')}>
      <RequireAuth>
        <Suspense fallback={<p className="help">{t('loading')}</p>}>
          <GoalsWorkspace />
        </Suspense>
      </RequireAuth>
    </AppShell>
  );
}
