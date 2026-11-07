'use client';

import { useTranslations } from 'next-intl';
import { AppShell } from '@/components/AppShell';
import { PageSkeleton } from '@/components/Skeleton';

/**
 * The loading screen for pages that fetch on the server (loading.tsx): the
 * app frame stays where it is and the page's place holds quiet blocks, so
 * nothing jumps when the page arrives.
 */
export function PageLoading() {
  const t = useTranslations('common');
  return (
    <AppShell>
      <PageSkeleton label={t('loading')} />
    </AppShell>
  );
}
