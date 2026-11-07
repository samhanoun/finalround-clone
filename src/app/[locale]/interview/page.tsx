import { Link } from '@/i18n/routing';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { NewPracticeButton } from '@/components/NewPracticeButton';
import { createClient } from '@/lib/supabase/server';
import styles from '../dashboard/dashboard.module.css';

const STATUSES = ['draft', 'in_progress', 'completed'] as const;

/** Practice interviews: answer questions in a mock session and get feedback. */
export default async function PracticePage() {
  const t = await getTranslations('PracticePages');
  const format = await getFormatter();
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <AppShell title={t('title')}>
        <RequireAuth>
          <div />
        </RequireAuth>
      </AppShell>
    );
  }

  const { data: sessions } = await supabase
    .from('interview_sessions')
    .select('id,title,status,created_at,interview_reports(overall_score,generated_at)')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <AppShell
      title={t('title')}
      actions={
        <>
          <Link className="button" href="/interview/bank">
            {t('bank')}
          </Link>
          <NewPracticeButton primary label={t('new')} />
        </>
      }
    >
      <RequireAuth>
        <section className="card" aria-labelledby="practice-heading">
          <div className="cardInner stack">
            <div>
              <h2 className="cardTitle" id="practice-heading">
                {t('listTitle')}
              </h2>
              <p className="cardDesc">{t('listDesc')}</p>
            </div>
            <ul className={styles.list}>
              {(sessions ?? []).length ? (
                (sessions ?? []).map((s) => {
                  const reports = (s.interview_reports ?? []) as Array<{ overall_score: number | null; generated_at: string }>;
                  const latest = [...reports].sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
                  return (
                    <li key={s.id} className={styles.listRow}>
                      <Link href={`/interview/${s.id}`} className={styles.rowLink}>
                        {s.title}
                      </Link>
                      <span className={styles.rowMeta}>
                        {typeof latest?.overall_score === 'number' ? (
                          <span className="badge badgeLive">{t('score', { score: latest.overall_score })}</span>
                        ) : null}
                        <span className="badge">
                          {(STATUSES as readonly string[]).includes(s.status) ? t(`status.${s.status}`) : s.status}
                        </span>
                        <span>{format.dateTime(new Date(s.created_at), { dateStyle: 'medium' })}</span>
                      </span>
                    </li>
                  );
                })
              ) : (
                <li className={styles.empty}>{t('empty')}</li>
              )}
            </ul>
          </div>
        </section>
      </RequireAuth>
    </AppShell>
  );
}
