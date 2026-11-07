'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { ExportButton } from './ExportButton';
import { funnelCsvRows, type JobFunnel } from '@/lib/analytics/jobSearch';
import styles from './JobAnalytics.module.css';

/** Analytics → Funnel: the user's job search, from the Jobs board. */
export function FunnelVisualization() {
  const t = useTranslations('Funnel');
  const [data, setData] = useState<JobFunnel | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/analytics/funnel');
        if (!res.ok) throw new Error();
        const json = (await res.json()) as JobFunnel;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <section className="card">
        <div className="cardInner">
          <p className="help">{t('failed')}</p>
        </div>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="card">
        <div className="cardInner">
          <p className="help">{t('loading')}</p>
        </div>
      </section>
    );
  }

  const top = Math.max(1, data.stages[0]?.count ?? 0);

  return (
    <section className="card" aria-labelledby="funnel-title">
      <div className="cardInner stack">
        <div className={styles.head}>
          <div>
            <h2 className="cardTitle" id="funnel-title">
              {t('title')}
            </h2>
            <p className="help">
              {t('desc')} {data.rejected ? t('rejected', { count: data.rejected }) : ''}
            </p>
          </div>
          {data.total ? <ExportButton
              data={funnelCsvRows(data, { stage: t('csv.stage'), jobs: t('csv.jobs'), fromPrevious: t('csv.fromPrevious') }, (key) => t(`stages.${key}`))}
              elementId="funnel-detail"
              filename="job-search-funnel"
              title={t('title')}
            /> : null}
        </div>

        {data.total === 0 ? (
          <div className={styles.empty}>
            <p>{t('empty')}</p>
            <Link className="button buttonPrimary" href="/jobs">
              {t('openJobs')}
            </Link>
          </div>
        ) : (
          <ol className={styles.funnel} id="funnel-detail">
            {data.stages.map((stage) => (
              <li key={stage.key} className={styles.funnelRow}>
                <span className={styles.funnelLabel}>{t(`stages.${stage.key}`)}</span>
                <span className={styles.funnelTrack} aria-hidden="true">
                  <span className={styles.funnelBar} data-stage={stage.key} style={{ width: `${(stage.count / top) * 100}%` }} />
                </span>
                <span className={styles.funnelCount}>{stage.count}</span>
                <span className={styles.funnelRate}>
                  {stage.fromPrevious === null ? '' : t('fromPrevious', { percent: stage.fromPrevious })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
