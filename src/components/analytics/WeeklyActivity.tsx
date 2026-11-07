'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ExportButton } from './ExportButton';
import { weeklyCsvRows, type WeekActivity } from '@/lib/analytics/jobSearch';
import styles from './JobAnalytics.module.css';

const ROWS: Array<keyof Omit<WeekActivity, 'week'>> = ['practice', 'averageScore', 'liveSessions', 'liveMinutes', 'applied'];
type Metric = (typeof ROWS)[number];
type Datum = { week: string; label: string; value: number | null; current: boolean };

/** Analytics → Week by week: one activity at a time over the last 8 weeks, as bars. This week is in Ember, the rest neutral. */
export function WeeklyActivity() {
  const t = useTranslations('Weekly');
  const format = useFormatter();
  const weekLabel = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const [weeks, setWeeks] = useState<WeekActivity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [metric, setMetric] = useState<Metric>('practice');

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

  const any = Boolean(weeks?.some((week) => week.practice || week.liveSessions || week.applied));
  const value = (n: number | null) => (n === null ? '–' : format.number(n));
  const data: Datum[] = (weeks ?? []).map((week, i, all) => ({
    week: week.week,
    label: weekLabel(week.week),
    value: week[metric],
    current: i === all.length - 1,
  }));
  const thisWeek = weeks?.at(-1);
  const lastWeek = weeks?.at(-2);
  const metricHasData = data.some((d) => d.value !== null && d.value > 0);

  return (
    <section className={styles.section} aria-labelledby="weekly-title">
      <div className={styles.head}>
        <div>
          <h2 className={styles.title} id="weekly-title">
            {t('title')}
          </h2>
          <p className={styles.desc}>{t('desc')}</p>
        </div>
        {weeks && any ? (
          <ExportButton
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
          />
        ) : null}
      </div>

      {failed ? (
        <p className={styles.status} role="alert">
          {t('failed')}
        </p>
      ) : !weeks ? (
        <p className={styles.status} role="status">
          {t('loading')}
        </p>
      ) : !any ? (
        <div className="emptyState">
          <p className={styles.emptyText}>{t('empty')}</p>
        </div>
      ) : (
        <div className={styles.weekly} id="weekly-detail">
          <div className={styles.panels}>
            <div className="card">
              <div className="cardInner">
                <div className={styles.metrics} role="group" aria-label={t('metricLabel')}>
                  {ROWS.map((row) => (
                    <button
                      key={row}
                      type="button"
                      className={styles.metric}
                      aria-pressed={metric === row}
                      onClick={() => setMetric(row)}
                    >
                      {t(`rows.${row}`)}
                    </button>
                  ))}
                </div>
                {metricHasData ? (
                  <div className={styles.chartBox} aria-hidden="true">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data} margin={{ top: 24, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={8} interval="preserveStartEnd" />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          width={32}
                          tickCount={4}
                          domain={metric === 'averageScore' ? [0, 100] : [0, 'auto']}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(237, 237, 237, 0.04)' }}
                          isAnimationActive={false}
                          content={({ active, payload }) => {
                            const point = active && payload?.length ? (payload[0].payload as Datum) : null;
                            if (!point) return null;
                            return (
                              <div className={styles.tip}>
                                <span className={styles.tipLabel}>{t('weekOf', { date: point.label })}</span>
                                <span className={styles.tipValue}>{point.value === null ? t('noScore') : value(point.value)}</span>
                              </div>
                            );
                          }}
                        />
                        <Bar
                          dataKey="value"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={32}
                          isAnimationActive={false}
                          label={(props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
                            const point = data[props.index ?? -1];
                            if (!point?.current || point.value === null) return <g key={`label-${props.index}`} />;
                            return (
                              <text
                                key="current-label"
                                x={Number(props.x) + Number(props.width) / 2}
                                y={Number(props.y) - 8}
                                textAnchor="middle"
                                className={styles.barLabel}
                              >
                                {value(point.value)}
                              </text>
                            );
                          }}
                        >
                          {data.map((point) => (
                            <Cell key={point.week} fill={point.current ? 'var(--accent)' : 'var(--text-3)'} fillOpacity={point.current ? 1 : 0.45} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className={styles.chartEmpty}>{t('metricEmpty')}</p>
                )}
              </div>
            </div>

            {thisWeek ? (
              <div className="card">
                <div className="cardInner">
                  <h3 className={styles.panelTitle}>{t('thisWeek')}</h3>
                  <dl className={styles.weekList}>
                    {ROWS.map((row) => (
                      <div key={row} className={styles.weekRow}>
                        <dt>{t(`rows.${row}`)}</dt>
                        <dd className={styles.weekValue}>{value(thisWeek[row])}</dd>
                        <dd className={styles.weekBefore}>{t('lastWeekValue', { value: value(lastWeek ? lastWeek[row] : null) })}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            ) : null}
          </div>

          <details className={styles.tableView}>
            <summary>{t('table')}</summary>
            <table className={styles.wideTable}>
              <caption className="srOnly">{t('desc')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('csv.week')}</th>
                  {ROWS.map((row) => (
                    <th key={row} scope="col">
                      {t(`rows.${row}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.week}>
                    <th scope="row">{weekLabel(week.week)}</th>
                    {ROWS.map((row) => (
                      <td key={row}>{value(week[row])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Phones: the same weeks as a list. */}
            <ul className={styles.narrowList} aria-label={t('desc')}>
              {weeks.map((week) => (
                <li key={week.week}>
                  <span className={styles.narrowDate}>{t('weekOf', { date: weekLabel(week.week) })}</span>
                  <span className={styles.narrowValues}>
                    {ROWS.map((row) => `${t(`rows.${row}`)} ${value(week[row])}`).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
