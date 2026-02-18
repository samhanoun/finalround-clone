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
    id: 'job-tracker',
    title: 'Job Tracker',
    description: 'Track applications and manage your job search pipeline',
    href: '/jobs',
    icon: '💼',
    variant: 'accent',
  },
  {
    id: 'resume',
    title: 'Resume Builder',
    description: 'Upload and optimize your resume for ATS',
    href: '/resume',
    icon: '📄',
    variant: 'accent',
  },
];

export function QuickActions() {
  return (
    <section id="quick-actions" aria-labelledby="quick-actions-heading">
      <h2 className="cardTitle" id="quick-actions-heading" style={{ marginBottom: 16 }}>
        Quick Actions
      </h2>
      <div 
        className={styles.quickActionsGrid} 
        role="navigation" 
        aria-label="Quick actions navigation"
      >
        {quickActions.map((action) => (
          <Link 
            key={action.id} 
            href={action.href} 
            className={`${styles.quickActionCard} ${styles[action.variant]}`}
            aria-label={`${action.title}: ${action.description}`}
          >
            <div className={styles.quickActionIcon} aria-hidden="true">{action.icon}</div>
            <div className={styles.quickActionContent}>
              <h3 className={styles.quickActionTitle}>{action.title}</h3>
              <p className={styles.quickActionDesc}>{action.description}</p>
            </div>
            <span className={styles.quickActionArrow} aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
