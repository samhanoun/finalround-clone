import Link from 'next/link';
import type { ComponentType } from 'react';
import { ChartIcon, JobsIcon, PracticeIcon, ResumeIcon } from './icons';
import styles from './QuickActions.module.css';

interface QuickAction {
  id: string;
  title: string;
  description: string;
  href: string;
  Icon: ComponentType<{ size?: number }>;
}

/** The live copilot has its own panel above; these are the other places to go. */
const quickActions: QuickAction[] = [
  {
    id: 'mock-interview',
    title: 'Practice an interview',
    description: 'Answer questions and get a score',
    href: '/interview',
    Icon: PracticeIcon,
  },
  {
    id: 'resume',
    title: 'Résumé',
    description: 'Upload it and tune it to a job',
    href: '/resume',
    Icon: ResumeIcon,
  },
  {
    id: 'job-tracker',
    title: 'Jobs',
    description: 'Track where you have applied',
    href: '/jobs',
    Icon: JobsIcon,
  },
  {
    id: 'analytics',
    title: 'Analytics',
    description: 'Your sessions over time',
    href: '/analytics',
    Icon: ChartIcon,
  },
];

export function QuickActions() {
  return (
    <nav id="quick-actions" className={styles.quickActionsGrid} aria-label="Quick actions">
      {quickActions.map(({ id, title, description, href, Icon }) => (
        <Link key={id} href={href} className={styles.quickActionCard}>
          <span className={styles.quickActionIcon}>
            <Icon size={20} />
          </span>
          <span className={styles.quickActionContent}>
            <span className={styles.quickActionTitle}>{title}</span>
            <span className={styles.quickActionDesc}>{description}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
