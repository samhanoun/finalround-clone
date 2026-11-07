'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/routing';
import { useFormatter, useTranslations } from 'next-intl';
import { ExportButton } from './ExportButton';
import { funnelCsvRows, type JobFunnel } from '@/lib/analytics/jobSearch';
import styles from './JobAnalytics.module.css';

/** Analytics → Job search: the user's funnel from the Jobs board, as a list with thin bars. Offer, the goal, carries the accent. */
export function FunnelVisualization() {
  const t = useTranslations('Funnel');
  const format = useFormatter();
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

  const top = Math.max(1, data?.stages[0]?.count ?? 0);

  return (
    <section className={styles.section} aria-labelledby="funnel-title">
      <div className={styles.head}>
        <div>
          <h2 className={styles.title} id="funnel-title">
            {t('title')}
          </h2>
          <p className={styles.desc}>
            {t('desc')} {data?.rejected ? t('rejected', { count: data.rejected }) : ''}
          </p>
        </div>
        {data?.total ? (
          <ExportButton
            data={funnelCsvRows(data, { stage: t('csv.stage'), jobs: t('csv.jobs'), fromPrevious: t('csv.fromPrevious') }, (key) => t(`stages.${key}`))}
            elementId="funnel-detail"
            filename="job-search-funnel"
            title={t('title')}
          />
        ) : null}
      </div>

      {failed ? (
        <p className={styles.status} role="alert">
          {t('failed')}
        </p>
      ) : !data ? (
        <p className={styles.status} role="status">
          {t('loading')}
        </p>
      ) : data.total === 0 ? (
        <div className="emptyState">
          <p className={styles.emptyText}>{t('empty')}</p>
          <Link className="button buttonPrimary" href="/jobs">
            {t('openJobs')}
          </Link>
        </div>
      ) : (
        <div className="card">
          <div className="cardInner">
            <ol className={styles.funnel} id="funnel-detail">
              {data.stages.map((stage) => (
                <li key={stage.key} className={styles.funnelRow} data-stage={stage.key}>
                  <span className={styles.funnelLabel}>{t(`stages.${stage.key}`)}</span>
                  <span className={styles.funnelCount}>{format.number(stage.count)}</span>
                  <span className={styles.funnelTrack} aria-hidden="true">
                    {/* A stage at zero draws nothing; any other gets at least a visible sliver. */}
                    {stage.count > 0 ? (
                      <span className={styles.funnelBar} style={{ width: `max(4px, ${(stage.count / top) * 100}%)` }} />
                    ) : null}
                  </span>
                  <span className={styles.funnelRate}>
                    {stage.fromPrevious === null ? '' : t('fromPrevious', { percent: stage.fromPrevious })}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
