import { getFormatter, getTranslations } from 'next-intl/server';
import type { HomeStats } from '@/app/[locale]/dashboard/homeData';
import styles from './DashboardStats.module.css';

/** Home's four figures. Each change says what it compares to, and only appears where it can be worked out honestly. */
export async function DashboardStats({ stats }: { stats: HomeStats }) {
  const t = await getTranslations('Home');
  const format = await getFormatter();
  const signed = (n: number) => format.number(n, { signDisplay: 'exceptZero' });

  const { score, liveMinutes } = stats;
  let scoreNote: { text: string; tone?: 'up' | 'down' };
  if (score.change.kind === 'none') scoreNote = { text: t('stats.scoreNone') };
  else if (score.change.kind === 'new') scoreNote = { text: t('stats.scoreNew') };
  else if (score.change.diff === 0) scoreNote = { text: t('stats.scoreSame') };
  else scoreNote = { text: t('stats.scoreChange', { diff: signed(score.change.diff) }), tone: score.change.diff > 0 ? 'up' : 'down' };

  const liveNote =
    liveMinutes.change === null ? null : liveMinutes.change === 0 ? t('stats.liveSame') : t('stats.liveChange', { diff: signed(liveMinutes.change) });

  const items: Array<{ key: string; label: string; value: React.ReactNode; note: string | null; tone?: 'up' | 'down' }> = [
    {
      key: 'practice',
      label: t('statInterviews'),
      value: format.number(stats.practice.total),
      note: t('stats.thisMonth', { count: stats.practice.thisMonth }),
    },
    {
      key: 'score',
      label: t('statScore'),
      value:
        score.average === null ? (
          '—'
        ) : (
          <>
            {format.number(score.average)}
            <span className={styles.unit}>/100</span>
          </>
        ),
      note: scoreNote.text,
      tone: scoreNote.tone,
    },
    {
      key: 'applications',
      label: t('statApplications'),
      value: format.number(stats.applications.total),
      note: t('stats.thisMonth', { count: stats.applications.thisMonth }),
    },
    { key: 'live', label: t('statLiveMinutes'), value: format.number(liveMinutes.thisMonth), note: liveNote },
  ];

  return (
    <section id="stats" className={styles.stats} aria-label={t('progress')}>
      <dl className={styles.grid}>
        {items.map((item) => (
          <div key={item.key} className={styles.stat}>
            <dt className={styles.label}>{item.label}</dt>
            <dd className={styles.value}>{item.value}</dd>
            <dd className={`${styles.note} ${item.tone ? styles[item.tone] : ''}`}>{item.note ?? ' '}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
