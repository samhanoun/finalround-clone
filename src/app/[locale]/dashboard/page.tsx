import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { createClient } from '@/lib/supabase/server';
import { DashboardClient } from '@/components/DashboardClient';
import { UsageWidget } from '@/components/UsageWidget';
import { DashboardStats } from '@/components/DashboardStats';
import { RecentActivity } from '@/components/RecentActivity';
import { QuickActions } from '@/components/QuickActions';
import { BadgesList } from '@/components/BadgesList';
import { ReferralPanel } from '@/components/ReferralPanel';
import styles from './dashboard.module.css';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  // Check if onboarding is completed
  if (data.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('id', data.user.id)
      .single();

    if (!profile?.onboarding_completed) {
      redirect('/onboarding');
    }
  }

  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select('id,title,status,created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: docs } = await supabase
    .from('resume_documents')
    .select('id,filename,created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  return (
    <AppShell
      title="Home"
      actions={
        <Link className="button buttonPrimary" href="/copilot/live">
          Start a live session
        </Link>
      }
    >
      <RequireAuth>
        <div className={styles.dash}>
          <DashboardClient />

          <QuickActions />

          <div className={styles.columns}>
            <div className={styles.main}>
              <DashboardStats />

              <section id="sessions" className="card" aria-labelledby="sessions-heading">
                <div className="cardInner stack">
                  <div className={styles.cardHeader}>
                    <h2 className="cardTitle" id="sessions-heading">
                      Practice interviews
                    </h2>
                    <Link className="button buttonGhost" href="/interview">
                      All practice
                    </Link>
                  </div>
                  <ul className={styles.list}>
                    {(sessions ?? []).length ? (
                      (sessions ?? []).map((s) => (
                        <li key={s.id} className={styles.listRow}>
                          <Link href={`/interview/${s.id}`} className={styles.rowLink}>
                            {s.title}
                          </Link>
                          <span className={styles.rowMeta}>
                            <span className="badge">{s.status}</span>
                            <span>{new Date(s.created_at).toLocaleDateString()}</span>
                          </span>
                        </li>
                      ))
                    ) : (
                      <li className={styles.empty}>No practice interviews yet. Start one to get a score and feedback.</li>
                    )}
                  </ul>
                </div>
              </section>

              <section id="resume" className="card" aria-labelledby="resumes-heading">
                <div className="cardInner stack">
                  <div className={styles.cardHeader}>
                    <h2 className="cardTitle" id="resumes-heading">
                      Your résumés
                    </h2>
                    <Link className="button buttonGhost" href="/resume">
                      Open résumé builder
                    </Link>
                  </div>
                  <ul className={styles.list}>
                    {(docs ?? []).length ? (
                      (docs ?? []).map((d) => (
                        <li key={d.id} className={styles.listRow}>
                          <span>{d.filename ?? d.id}</span>
                          <span className={styles.rowMeta}>{new Date(d.created_at).toLocaleDateString()}</span>
                        </li>
                      ))
                    ) : (
                      <li className={styles.empty}>No résumés yet. Upload one so answers can use your experience.</li>
                    )}
                  </ul>
                </div>
              </section>
            </div>

            <aside className={styles.side}>
              <UsageWidget />
              <RecentActivity />
            </aside>
          </div>

          <div className={styles.social}>
            <BadgesList />
            <ReferralPanel />
          </div>
        </div>
      </RequireAuth>
    </AppShell>
  );
}
