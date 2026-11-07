'use client';

import { useId } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from '@/i18n/routing';
import type { TrendPoint } from './homeData';
import { useInBrowser } from './LocalDateTime';
import styles from './dashboard.module.css';

type Datum = { i: number; at: string; score: number };

/**
 * Home's one rich element: the practice score over the latest scored
 * interviews. A neutral line, Ember on the latest point only, muted mono
 * labels. Under two points there is no trend yet, so it says so instead.
 */
export function ScoreTrend({ points }: { points: TrendPoint[] }) {
  const t = useTranslations('Home.trend');
  const format = useFormatter();
  const inBrowser = useInBrowser();
  const fillId = `trend-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const data: Datum[] = points.map((point, i) => ({ i, at: point.at, score: point.score }));
  const latest = data.at(-1);
  const previous = data.at(-2);
  const enough = data.length >= 2 && latest && previous;
  const day = (at: string) => format.dateTime(new Date(at), { month: 'short', day: 'numeric' });
  // Several interviews on one day share a date: only the last of them carries the tick label.
  const tick = (i: number) => (data[i] && !(data[i + 1] && day(data[i + 1].at) === day(data[i].at)) ? day(data[i].at) : '');

  // The axis starts a little below the lowest score, on a step of 20 so its middle tick is round, and always reaches 100.
  const low = data.length ? Math.min(...data.map((d) => d.score)) : 0;
  const floor = Math.max(0, Math.floor((low - 10) / 20) * 20);
  const ticks = [floor, (floor + 100) / 2, 100];

  const diff = enough ? latest.score - previous.score : 0;

  return (
    <section className={`card ${styles.trend}`} aria-labelledby="score-trend-title">
      <div className={`cardInner ${styles.trendInner}`}>
        <div className={styles.trendHead}>
          <div>
            <h2 className="cardTitle" id="score-trend-title">
              {t('title')}
            </h2>
            <p className="cardDesc">{t('desc', { count: data.length })}</p>
          </div>
          {enough ? (
            <div className={styles.trendFigure}>
              <span className={styles.trendValue}>
                {format.number(latest.score)}
                <span className={styles.trendUnit}>/100</span>
              </span>
              <span className={styles.trendChange}>
                {diff === 0 ? t('samePrevious') : t('vsPrevious', { diff: format.number(diff, { signDisplay: 'exceptZero' }) })}
              </span>
            </div>
          ) : null}
        </div>

        {enough ? (
          <>
            <div className={styles.chart} aria-hidden="true">
              {inBrowser ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--text-1)" stopOpacity={0.1} />
                        <stop offset="100%" stopColor="var(--text-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="i"
                      tickFormatter={tick}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={32}
                      tickMargin={10}
                      padding={{ left: 8, right: 8 }}
                    />
                    <YAxis domain={[floor, 100]} ticks={ticks} tickLine={false} axisLine={false} width={36} tickMargin={6} />
                    <Tooltip
                      cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
                      isAnimationActive={false}
                      content={({ active, payload }) => {
                        const point = active && payload?.length ? (payload[0].payload as Datum) : null;
                        return point ? (
                          <div className={styles.tip}>
                            <span className={styles.tipValue}>
                              {point.score}
                              <span className={styles.trendUnit}>/100</span>
                            </span>
                            <span className={styles.tipLabel}>{day(point.at)}</span>
                          </div>
                        ) : null;
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="var(--text-2)"
                      strokeWidth={2}
                      fill={`url(#${fillId})`}
                      isAnimationActive={false}
                      activeDot={{ r: 4, fill: 'var(--text-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
                      dot={(props: { cx?: number; cy?: number; index?: number }) => {
                        const { cx, cy, index } = props;
                        if (index !== data.length - 1 || cx === undefined || cy === undefined) return <g key={`dot-${index}`} />;
                        return <circle key="latest" cx={cx} cy={cy} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />;
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </div>
            {/* The same scores for screen readers, as a list. */}
            <ol className="srOnly" aria-label={t('listLabel')}>
              {data.map((point) => (
                <li key={point.i}>
                  {inBrowser ? t('point', { date: day(point.at), score: point.score }) : point.score}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className={styles.trendEmpty}>
            <p>{latest ? t('emptyOne', { score: latest.score }) : t('emptyNone')}</p>
            <Link className="button buttonSmall" href="/interview">
              {t('practice')}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
