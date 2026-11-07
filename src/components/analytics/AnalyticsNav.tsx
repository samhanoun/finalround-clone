'use client';

import { useEffect, useRef } from 'react';
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

/** The four analytics views, as underline tabs that scroll sideways on phones. */
export function AnalyticsNav() {
  const t = useTranslations('AnalyticsNav');
  const path = (usePathname() ?? '').replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
  const current = useRef<HTMLAnchorElement>(null);

  // On a narrow screen the current tab may sit past the edge: bring it into view.
  useEffect(() => {
    current.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [path]);

  return (
    <nav className={styles.nav} aria-label={t('label')}>
      {VIEWS.map(({ href, key }) => (
        <Link
          key={href}
          href={href}
          ref={path === href ? current : undefined}
          className={styles.tabLink}
          aria-current={path === href ? 'page' : undefined}
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
