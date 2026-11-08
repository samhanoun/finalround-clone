import { Link } from '@/i18n/routing';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { NewPracticeButton } from '@/components/NewPracticeButton';
import { ScoreTrend } from '@/components/practice/ScoreTrend';
import { PracticeList } from '@/components/practice/PracticeList';
import { createClient } from '@/lib/supabase/server';
import styles from '@/components/practice/PracticeList.module.css';

const STATUSES = ['draft', 'in_progress', 'completed'] as const;
/** How many completed interviews the trend shows. */
const TREND_POINTS = 12;

type SessionRow = { id: string; title: string | null; status: string; created_at: string };
type ReportRow = { session_id: string; overall_score: number | null; generated_at: string };

/** Practice interviews: answer questions in a mock session and get feedback. */
export default async function PracticePage() {
  const t = await getTranslations('PracticePages');
  const tPractice = await getTranslations('Practice');
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

  const [{ data: sessionData }, { data: reportData }] = await Promise.all([
    supabase.from('interview_sessions').select('id,title,status,created_at').order('created_at', { ascending: false }).limit(50),
    supabase.from('interview_reports').select('session_id,overall_score,generated_at').order('generated_at', { ascending: false }).limit(200),
  ]);
  const sessions = (sessionData ?? []) as SessionRow[];

  // Each interview's latest report score (reports come newest first).
  const scores = new Map<string, number>();
  for (const report of (reportData ?? []) as ReportRow[]) {
    if (!scores.has(report.session_id) && typeof report.overall_score === 'number') scores.set(report.session_id, report.overall_score);
  }

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const scored = sessions
    .filter((session) => scores.has(session.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-TREND_POINTS);
  const points = scored.map((session) => ({ score: scores.get(session.id) ?? 0, date: date(session.created_at) }));
  const delta = points.length > 1 ? points[points.length - 1].score - points[points.length - 2].score : null;
  const direction = delta === null ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
  const change =
    delta === null
      ? t('firstScore')
      : direction === 'up'
        ? t('changeUp', { delta })
        : direction === 'down'
          ? t('changeDown', { delta: Math.abs(delta) })
          : t('changeSame');

  const bankLink = (
    <Link className="button" href="/interview/bank">
      {t('bank')}
    </Link>
  );

  return (
    <AppShell
      title={t('title')}
      actions={
        sessions.length ? (
          <>
            {bankLink}
            <NewPracticeButton primary label={t('new')} />
          </>
        ) : (
          bankLink
        )
      }
    >
      <RequireAuth>
        {sessions.length === 0 ? (
          <div className={`emptyState ${styles.empty}`}>
            <p>{t('empty')}</p>
            <NewPracticeButton primary label={t('new')} />
          </div>
        ) : (
          <div className={styles.page}>
            {points.length ? (
              <ScoreTrend
                points={points}
                title={t('trendTitle')}
                outOf={tPractice('report.outOf')}
                change={change}
                direction={direction}
                chartLabel={t('trendChart', { count: points.length })}
              />
            ) : null}

            <section className={styles.listPanel} aria-labelledby="practice-heading">
              {/* Focus lands here after a row is deleted. */}
              <h2 className={styles.listTitle} id="practice-heading" tabIndex={-1}>
                {t('listTitle')}
              </h2>
              <div className={styles.listHead} aria-hidden="true">
                <span>{t('columns.interview')}</span>
                <span>{t('columns.status')}</span>
                <span>{t('columns.score')}</span>
                <span>{t('columns.date')}</span>
              </div>
              <PracticeList
                headingId="practice-heading"
                items={sessions.map((session) => ({
                  id: session.id,
                  title: session.title,
                  status: session.status,
                  statusLabel: (STATUSES as readonly string[]).includes(session.status) ? t(`status.${session.status}`) : session.status,
                  score: scores.get(session.id) ?? null,
                  date: date(session.created_at),
                }))}
              />
            </section>
          </div>
        )}
      </RequireAuth>
    </AppShell>
  );
}
