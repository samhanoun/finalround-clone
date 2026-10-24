'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './AnalyticsNav.module.css';

const VIEWS = [
  { href: '/analytics', label: 'Overview' },
  { href: '/analytics/funnel', label: 'Funnel' },
  { href: '/analytics/cohort', label: 'Cohorts' },
  { href: '/analytics/reports', label: 'Reports' },
];

/** The four analytics views, as one segmented control. */
export function AnalyticsNav() {
  const path = (usePathname() ?? '').replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
  return (
    <nav className={styles.nav} aria-label="Analytics views">
      {VIEWS.map(({ href, label }) => (
        <Link key={href} href={href} className={styles.link} aria-current={path === href ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
