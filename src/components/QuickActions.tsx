import Link from 'next/link';
import styles from './QuickActions.module.css';

interface QuickAction {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: string;
  variant: 'primary' | 'secondary' | 'accent';
}

const quickActions: QuickAction[] = [
  {
    id: 'mock-interview',
    title: 'Start Mock Interview',
    description: 'Practice with AI-powered interview sessions',
    href: '/interview/new',
    icon: '🎯',
    variant: 'primary',
  },
  {
    id: 'copilot',
    title: 'Launch Copilot',
    description: 'Get real-time interview assistance',
    href: '/copilot/live',
    icon: '🤖',
    variant: 'secondary',
  },
  {
    id: 'apply-jobs',
    title: 'Apply to Jobs',
    description: 'Browse and apply to job opportunities',
    href: '/jobs',
    icon: '💼',
    variant: 'accent',
  },
];

export function QuickActions() {
  return (
    <section id="quick-actions">
      <h2 className="cardTitle" style={{ marginBottom: 16 }}>Quick Actions</h2>
      <div className={styles.quickActionsGrid}>
        {quickActions.map((action) => (
          <Link key={action.id} href={action.href} className={`${styles.quickActionCard} ${styles[action.variant]}`}>
            <div className={styles.quickActionIcon}>{action.icon}</div>
            <div className={styles.quickActionContent}>
              <h3 className={styles.quickActionTitle}>{action.title}</h3>
              <p className={styles.quickActionDesc}>{action.description}</p>
            </div>
            <span className={styles.quickActionArrow}>→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
