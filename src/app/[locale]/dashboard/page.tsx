import { Link, redirect } from '@/i18n/routing';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
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

const STATUSES = ['draft', 'in_progress', 'completed'];

export default async function DashboardPage() {
  const t = await getTranslations('Home');
  const tPractice = await getTranslations('PracticePages');
  const format = await getFormatter();
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
      redirect({ href: '/onboarding', locale: await getLocale() });
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
      title={t('title')}
      actions={
        <Link className="button buttonPrimary" href="/copilot/live">
          {t('startLive')}
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
                      {t('practiceTitle')}
                    </h2>
                    <Link className="button buttonGhost" href="/interview">
                      {t('allPractice')}
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
                            <span className="badge">{STATUSES.includes(s.status) ? tPractice(`status.${s.status}`) : s.status}</span>
                            <span>{format.dateTime(new Date(s.created_at), { dateStyle: 'medium' })}</span>
                          </span>
                        </li>
                      ))
                    ) : (
                      <li className={styles.empty}>{tPractice('empty')}</li>
                    )}
                  </ul>
                </div>
              </section>

              <section id="resume" className="card" aria-labelledby="resumes-heading">
                <div className="cardInner stack">
                  <div className={styles.cardHeader}>
                    <h2 className="cardTitle" id="resumes-heading">
                      {t('resumesTitle')}
                    </h2>
                    <Link className="button buttonGhost" href="/resume">
                      {t('openResume')}
                    </Link>
                  </div>
                  <ul className={styles.list}>
                    {(docs ?? []).length ? (
                      (docs ?? []).map((d) => (
                        <li key={d.id} className={styles.listRow}>
                          <span>{d.filename ?? d.id}</span>
                          <span className={styles.rowMeta}>{format.dateTime(new Date(d.created_at), { dateStyle: 'medium' })}</span>
                        </li>
                      ))
                    ) : (
                      <li className={styles.empty}>{t('resumesEmpty')}</li>
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
