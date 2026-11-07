import { Link } from '@/i18n/routing';
import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import { ChartIcon, JobsIcon, PracticeIcon, ResumeIcon } from './icons';
import styles from './QuickActions.module.css';

interface QuickAction {
  id: 'practice' | 'resume' | 'jobs' | 'analytics';
  href: string;
  Icon: ComponentType<{ size?: number }>;
}

/** The live copilot has its own panel above; these are the other places to go. */
const quickActions: QuickAction[] = [
  { id: 'practice', href: '/interview', Icon: PracticeIcon },
  { id: 'resume', href: '/resume', Icon: ResumeIcon },
  { id: 'jobs', href: '/jobs', Icon: JobsIcon },
  { id: 'analytics', href: '/analytics', Icon: ChartIcon },
];

export function QuickActions() {
  const t = useTranslations('Home.quick');
  return (
    <nav id="quick-actions" className={styles.quickActionsGrid} aria-label={t('label')}>
      {quickActions.map(({ id, href, Icon }) => (
        <Link key={id} href={href} className={styles.quickActionCard}>
          <span className={styles.quickActionIcon}>
            <Icon size={20} />
          </span>
          <span className={styles.quickActionContent}>
            <span className={styles.quickActionTitle}>{t(`${id}.title`)}</span>
            <span className={styles.quickActionDesc}>{t(`${id}.desc`)}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
