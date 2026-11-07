'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ExportButton } from './ExportButton';
import { weeklyCsvRows, type WeekActivity } from '@/lib/analytics/jobSearch';
import styles from './JobAnalytics.module.css';

const ROWS: Array<keyof Omit<WeekActivity, 'week'>> = ['practice', 'averageScore', 'liveSessions', 'liveMinutes', 'applied'];

/** Analytics → Weekly: what the user did each week, as a heat map. */
export function WeeklyActivity() {
  const t = useTranslations('Weekly');
  const format = useFormatter();
  const weekLabel = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const [weeks, setWeeks] = useState<WeekActivity[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/analytics/weekly');
        if (!res.ok) throw new Error();
        const json = (await res.json()) as { weeks: WeekActivity[] };
        if (!cancelled) setWeeks(json.weeks);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !weeks) {
    return (
      <section className="card">
        <div className="cardInner">
          <p className="help">{failed ? t('failed') : t('loading')}</p>
        </div>
      </section>
    );
  }

  const any = weeks.some((week) => week.practice || week.liveSessions || week.applied);

  return (
    <section className="card" aria-labelledby="weekly-title">
      <div className="cardInner stack">
        <div className={styles.head}>
          <div>
            <h2 className="cardTitle" id="weekly-title">
              {t('title')}
            </h2>
            <p className="help">{t('desc')}</p>
          </div>
          {any ? <ExportButton
              data={weeklyCsvRows(weeks, {
                week: t('csv.week'),
                practice: t('rows.practice'),
                averageScore: t('rows.averageScore'),
                liveSessions: t('rows.liveSessions'),
                liveMinutes: t('rows.liveMinutes'),
                applied: t('rows.applied'),
              })}
              elementId="weekly-detail"
              filename="weekly-activity"
              title={t('title')}
            /> : null}
        </div>

        {!any ? (
          <p className={styles.empty}>{t('empty')}</p>
        ) : (
          <div className={styles.heatWrap} id="weekly-detail">
            <table className={styles.heat}>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="srOnly">{t('activity')}</span>
                  </th>
                  {weeks.map((week) => (
                    <th key={week.week} scope="col">
                      {weekLabel(week.week)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const values = weeks.map((week) => week[row]);
                  const max = Math.max(1, ...values.map((value) => (typeof value === 'number' ? value : 0)));
                  return (
                    <tr key={row}>
                      <th scope="row">{t(`rows.${row}`)}</th>
                      {values.map((value, i) => {
                        const n = typeof value === 'number' ? value : null;
                        return (
                          <td
                            key={weeks[i].week}
                            style={{ ['--level' as string]: n === null ? 0 : n / max }}
                            data-empty={n === null || n === 0 ? 'true' : undefined}
                          >
                            {n === null ? '–' : n}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
