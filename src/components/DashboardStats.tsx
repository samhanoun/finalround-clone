import { createClient } from '@/lib/supabase/server';
import styles from './DashboardStats.module.css';

interface Stats {
  totalInterviews: number;
  avgScore: number | null;
  applicationsSubmitted: number;
}

export async function DashboardStats() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  
  if (!userData.user) {
    return null;
  }

  // Get total interviews count
  const { count: totalInterviews } = await supabase
    .from('interview_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userData.user.id);

  // Get average score from completed reports
  const { data: reports } = await supabase
    .from('interview_reports')
    .select('overall_score')
    .eq('user_id', userData.user.id);

  const avgScore = reports && reports.length > 0
    ? Math.round(reports.reduce((sum, r) => sum + (r.overall_score || 0), 0) / reports.length)
    : null;

  // Get applications count (from localStorage for now - can be expanded to DB)
  // For now, we'll show 0 as placeholder until job applications feature is implemented
  
  const stats: Stats = {
    totalInterviews: totalInterviews || 0,
    avgScore,
    applicationsSubmitted: 0, // Placeholder - can be connected to job applications DB
  };

  return (
    <section id="stats" className="card">
      <div className="cardInner">
        <h2 className="cardTitle" style={{ marginBottom: 16 }}>Your Stats</h2>
        <div className={styles.statsGrid}>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{stats.totalInterviews}</div>
            <div className={styles.statLabel}>Total Interviews</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{stats.avgScore !== null ? `${stats.avgScore}%` : '—'}</div>
            <div className={styles.statLabel}>Avg Score</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{stats.applicationsSubmitted}</div>
            <div className={styles.statLabel}>Applications Submitted</div>
          </div>
        </div>
      </div>
    </section>
  );
}
