import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import styles from './jobs.module.css';

export default function JobsPage() {
  return (
    <AppShell title="Job Applications">
      <RequireAuth>
        <div className="stack">
          <section className="card">
            <div className="cardInner stack">
              <h2 className="cardTitle">Job Applications</h2>
              <p className="cardDesc">
                Browse and apply to job opportunities. Track your applications and manage your job search journey.
              </p>
              
              <div className={styles.comingSoon}>
                <span className={styles.comingSoonIcon}>🚧</span>
                <h3>Coming Soon</h3>
                <p className="small">
                  Job applications feature is under development. Stay tuned for updates!
                </p>
              </div>
            </div>
          </section>
        </div>
      </RequireAuth>
    </AppShell>
  );
}
