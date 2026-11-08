import { Link } from '@/i18n/routing';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { HomeCopilot, HomeResume, HomeSession } from '@/app/[locale]/dashboard/homeData';
import { LiveIcon, PracticeIcon, ResumeIcon } from './icons';
import styles from './RecentActivity.module.css';

interface Activity {
  id: string;
  type: 'interview' | 'resume' | 'copilot';
  title: string;
  description: string;
  timestamp: string;
  href: string;
}

const ICONS = { interview: PracticeIcon, resume: ResumeIcon, copilot: LiveIcon } as const;
const SHOWN = 6;

/** Home → Recent activity: practice interviews, résumés and live sessions, newest first. */
export async function RecentActivity({
  sessions,
  resumes,
  copilot,
}: {
  sessions: HomeSession[];
  resumes: HomeResume[];
  copilot: HomeCopilot[];
}) {
  const t = await getTranslations('Home');
  const format = await getFormatter();

  const activities: Activity[] = [
    ...sessions.map((session) => ({
      id: session.id,
      type: 'interview' as const,
      title: session.title || t('untitledPractice'),
      description: session.status === 'completed' ? t('practiceFinished') : t('practiceInterview'),
      timestamp: session.created_at,
      href: `/interview/${session.id}`,
    })),
    ...resumes.map((resume) => ({
      id: `resume-${resume.id}`,
      type: 'resume' as const,
      title: resume.filename || t('resume'),
      description: t('resumeUploaded'),
      timestamp: resume.created_at,
      href: '/resume',
    })),
    ...copilot.map((session) => ({
      id: `copilot-${session.id}`,
      type: 'copilot' as const,
      title: session.title || t('liveSession'),
      description: session.status === 'active' ? t('liveRunning') : t('liveSession'),
      timestamp: session.created_at,
      href: '/copilot/live',
    })),
  ]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, SHOWN);

  const now = new Date();
  const timeAgo = (timestamp: string) => {
    const date = new Date(timestamp);
    const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
    if (minutes < 1) return t('justNow');
    // A week or more: the date itself.
    if (minutes >= 7 * 24 * 60) return format.dateTime(date, { dateStyle: 'medium' });
    return format.relativeTime(date, now);
  };

  return (
    <section id="activity" className="card" aria-labelledby="activity-heading">
      <div className="cardInner">
        <h2 className={`cardTitle ${styles.heading}`} id="activity-heading">
          {t('activity')}
        </h2>
        {activities.length > 0 ? (
          <ul className={styles.list}>
            {activities.map((activity) => {
              const Icon = ICONS[activity.type];
              return (
                <li key={activity.id} className={styles.item}>
                  <Icon size={16} className={styles.icon} />
                  <div className={styles.body}>
                    <Link href={activity.href} className={styles.titleLink}>
                      {activity.title}
                    </Link>
                    <span className={styles.desc}>{activity.description}</span>
                  </div>
                  <time className={styles.time} dateTime={activity.timestamp}>
                    {timeAgo(activity.timestamp)}
                  </time>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.empty}>{t('activityEmpty')}</p>
        )}
      </div>
    </section>
  );
}
