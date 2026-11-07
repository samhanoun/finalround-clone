'use client';

import { Link } from '@/i18n/routing';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import styles from './AnalyticsNav.module.css';

const VIEWS = [
  { href: '/analytics', key: 'overview' },
  { href: '/analytics/funnel', key: 'funnel' },
  { href: '/analytics/weekly', key: 'weekly' },
  { href: '/analytics/reports', key: 'reports' },
] as const;

/** The four analytics views, as one segmented control. */
export function AnalyticsNav() {
  const t = useTranslations('AnalyticsNav');
  const path = (usePathname() ?? '').replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
  return (
    <nav className={styles.nav} aria-label={t('label')}>
      {VIEWS.map(({ href, key }) => (
        <Link key={href} href={href} className={styles.link} aria-current={path === href ? 'page' : undefined}>
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
