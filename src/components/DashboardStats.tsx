import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import styles from './DashboardStats.module.css';

interface Stats {
  totalInterviews: number;
  avgScore: number | null;
  applicationsSubmitted: number;
}

export async function DashboardStats() {
  const t = await getTranslations('Home');
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  
  if (!userData.user) {
    return null;
  }

  const userId = userData.user.id;
  const [{ count: totalInterviews }, { data: reports }, { count: applicationsSubmitted }] = await Promise.all([
    supabase.from('interview_sessions').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('interview_reports').select('overall_score').eq('user_id', userId),
    // Sent = on the Jobs board and past "Saved" (applied, assessment, interview, offer or rejected).
    supabase
      .from('job_applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active')
      .neq('stage', 'saved'),
  ]);

  const scores = (reports ?? [])
    .map((r: { overall_score: number | null }) => r.overall_score)
    .filter((score): score is number => typeof score === 'number');
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;

  const stats: Stats = {
    totalInterviews: totalInterviews || 0,
    avgScore,
    applicationsSubmitted: applicationsSubmitted || 0,
  };

  return (
    <section id="stats" className="card">
      <div className="cardInner">
        <h2 className="cardTitle" style={{ marginBottom: 16 }}>{t('progress')}</h2>
        <div className={styles.statsGrid}>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{stats.totalInterviews}</div>
            <div className={styles.statLabel}>{t('statInterviews')}</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{stats.avgScore !== null ? `${stats.avgScore}%` : '—'}</div>
            <div className={styles.statLabel}>{t('statScore')}</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{stats.applicationsSubmitted}</div>
            <div className={styles.statLabel}>{t('statApplications')}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
