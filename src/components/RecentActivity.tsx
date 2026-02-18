import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import styles from './RecentActivity.module.css';

interface Activity {
  id: string;
  type: 'interview' | 'report' | 'resume' | 'copilot';
  title: string;
  description: string;
  timestamp: string;
  href?: string;
}

export async function RecentActivity() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  
  if (!userData.user) {
    return null;
  }

  const activities: Activity[] = [];

  // Fetch recent interview sessions
  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select('id, title, status, created_at')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (sessions) {
    sessions.forEach((session) => {
      activities.push({
        id: session.id,
        type: 'interview',
        title: session.title || 'Untitled Interview',
        description: `Interview ${session.status || 'created'}`,
        timestamp: session.created_at,
        href: `/interview/${session.id}`,
      });
    });
  }

  // Fetch recent resume uploads
  const { data: resumes } = await supabase
    .from('resume_documents')
    .select('id, filename, created_at')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })
    .limit(3);

  if (resumes) {
    resumes.forEach((resume) => {
      activities.push({
        id: `resume-${resume.id}`,
        type: 'resume',
        title: resume.filename || 'Resume',
        description: 'Resume uploaded',
        timestamp: resume.created_at,
        href: '/resume',
      });
    });
  }

  // Fetch recent copilot sessions
  const { data: copilotSessions } = await supabase
    .from('copilot_sessions')
    .select('id, title, status, created_at')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false })
    .limit(3);

  if (copilotSessions) {
    copilotSessions.forEach((session) => {
      activities.push({
        id: `copilot-${session.id}`,
        type: 'copilot',
        title: session.title || 'Copilot Session',
        description: `Copilot ${session.status || 'active'}`,
        timestamp: session.created_at,
        href: '/copilot/live',
      });
    });
  }

  // Sort all activities by timestamp (most recent first)
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Take top 8 activities
  const recentActivities = activities.slice(0, 8);

  const getActivityIcon = (type: Activity['type']) => {
    switch (type) {
      case 'interview':
        return '🎯';
      case 'report':
        return '📊';
      case 'resume':
        return '📄';
      case 'copilot':
        return '🤖';
      default:
        return '•';
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const date = new Date(timestamp);
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <section id="activity" className="card">
      <div className="cardInner">
        <h2 className="cardTitle" style={{ marginBottom: 16 }}>Recent Activity</h2>
        {recentActivities.length > 0 ? (
          <ul className={styles.activityList}>
            {recentActivities.map((activity) => (
              <li key={activity.id} className={styles.activityItem}>
                <span className={styles.activityIcon}>{getActivityIcon(activity.type)}</span>
                <div className={styles.activityContent}>
                  {activity.href ? (
                    <Link href={activity.href} className={styles.activityTitle}>
                      {activity.title}
                    </Link>
                  ) : (
                    <span className={styles.activityTitle}>{activity.title}</span>
                  )}
                  <span className={styles.activityDesc}>{activity.description}</span>
                </div>
                <span className={styles.activityTime}>{formatTimeAgo(activity.timestamp)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small">No recent activity. Start by creating your first mock interview!</p>
        )}
      </div>
    </section>
  );
}
