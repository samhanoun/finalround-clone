import { Link } from '@/i18n/routing';
import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import { ChartIcon, ChevronRightIcon, JobsIcon, PracticeIcon, ResumeIcon, type IconProps } from './icons';
import styles from './QuickActions.module.css';

interface QuickAction {
  id: 'practice' | 'resume' | 'jobs' | 'analytics';
  href: string;
  Icon: ComponentType<IconProps>;
}

/** Next up covers the live copilot; these are the other places to go, as a quiet list. */
const quickActions: QuickAction[] = [
  { id: 'practice', href: '/interview', Icon: PracticeIcon },
  { id: 'resume', href: '/resume', Icon: ResumeIcon },
  { id: 'jobs', href: '/jobs', Icon: JobsIcon },
  { id: 'analytics', href: '/analytics', Icon: ChartIcon },
];

export function QuickActions() {
  const t = useTranslations('Home.quick');
  return (
    <nav id="quick-actions" className={styles.nav} aria-labelledby="quick-actions-heading">
      <h2 className={styles.heading} id="quick-actions-heading">
        {t('label')}
      </h2>
      <ul className={styles.list}>
        {quickActions.map(({ id, href, Icon }) => (
          <li key={id}>
            <Link href={href} className={styles.rowLink}>
              <Icon size={16} className={styles.icon} />
              <span className={styles.text}>
                <span className={styles.title}>{t(`${id}.title`)}</span>
                <span className={styles.desc}>{t(`${id}.desc`)}</span>
              </span>
              <ChevronRightIcon size={16} className={styles.chevron} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
