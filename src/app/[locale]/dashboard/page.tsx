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
import { syncBadgesQuietly } from '@/lib/badges';
import { loadHome } from './homeData';
import { ScoreTrend } from './ScoreTrend';
import styles from './dashboard.module.css';

const STATUSES = ['draft', 'in_progress', 'completed'];

/**
 * Home. One main thing, the next interview, then the figures, the practice
 * score trend, and smaller blocks of different kinds: short lists and links
 * beside activity and usage, then achievements and invites. Phones read it in
 * that order.
 */
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

  const now = new Date();
  // Badges earned since the last visit are awarded before the page goes out, so Achievements lists them.
  // The sync never throws and is time-boxed: Home loads the same if it fails.
  const [home] = data.user ? await Promise.all([loadHome(supabase, data.user.id, now), syncBadgesQuietly(data.user.id)]) : [null];
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  return (
    <AppShell title={t('title')}>
      <RequireAuth>
        {home ? (
          <div className={styles.home}>
            <DashboardClient next={home.next} setup={home.setup} now={now.toISOString()} />

            <DashboardStats stats={home.stats} />

            <div className={styles.columns}>
              <div className={styles.main}>
                <ScoreTrend points={home.trend} />

                <div className={`card ${styles.lists}`}>
                  <section id="sessions" className={styles.listBlock} aria-labelledby="sessions-heading">
                    <div className={styles.listHead}>
                      <h2 className="cardTitle" id="sessions-heading">
                        {t('practiceTitle')}
                      </h2>
                      <Link className="button buttonGhost buttonSmall" href="/interview">
                        {t('allPractice')}
                      </Link>
                    </div>
                    {home.sessions.length ? (
                      <ul className={styles.list}>
                        {home.sessions.map((s) => (
                          <li key={s.id} className={styles.row}>
                            <Link href={`/interview/${s.id}`} className={styles.rowLink}>
                              {s.title || t('untitledPractice')}
                            </Link>
                            <span className={styles.rowMeta}>
                              <span className={styles.status} data-status={s.status}>
                                <span className="dot" aria-hidden="true" />
                                {STATUSES.includes(s.status) ? tPractice(`status.${s.status}`) : s.status}
                              </span>
                              <time dateTime={s.created_at}>{date(s.created_at)}</time>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.empty}>{tPractice('empty')}</p>
                    )}
                  </section>

                  <section id="resume" className={styles.listBlock} aria-labelledby="resumes-heading">
                    <div className={styles.listHead}>
                      <h2 className="cardTitle" id="resumes-heading">
                        {t('resumesTitle')}
                      </h2>
                      <Link className="button buttonGhost buttonSmall" href="/resume">
                        {t('openResume')}
                      </Link>
                    </div>
                    {home.resumes.length ? (
                      <ul className={styles.list}>
                        {home.resumes.map((d) => (
                          <li key={d.id} className={styles.row}>
                            <span className={styles.rowName}>{d.filename ?? d.id}</span>
                            <span className={styles.rowMeta}>
                              <time dateTime={d.created_at}>{date(d.created_at)}</time>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.empty}>{t('resumesEmpty')}</p>
                    )}
                  </section>
                </div>

                <QuickActions />
              </div>

              <div className={styles.side}>
                <RecentActivity {...home.activity} />
                <UsageWidget compact />
              </div>
            </div>

            <div className={styles.social}>
              <BadgesList />
              <ReferralPanel />
            </div>
          </div>
        ) : null}
      </RequireAuth>
    </AppShell>
  );
}
