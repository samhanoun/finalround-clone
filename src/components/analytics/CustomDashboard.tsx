'use client';

import { Link } from '@/i18n/routing';
import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { ExportButton } from './ExportButton';
import {
  OVERVIEW_RANGES,
  hasAnyActivity,
  summarizeOverview,
  type OverviewRange,
  type OverviewResponse,
} from '@/lib/analytics/overview';

interface MonthlyUsage {
  used: number;
  limit: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error' }
  | { status: 'ready'; overview: OverviewResponse; usage: MonthlyUsage | null };

/** This month's live-copilot minutes from /api/usage, or null when it can't say. */
async function loadMonthlyUsage(): Promise<MonthlyUsage | null> {
  try {
    const res = await fetch('/api/usage');
    if (!res.ok) return null;
    const json = await res.json();
    const used = json?.usage?.copilot_minutes_monthly;
    const limit = json?.limits?.copilot_minutes_monthly;
    return typeof used === 'number' && typeof limit === 'number' ? { used, limit } : null;
  } catch {
    return null;
  }
}

function Delta({ current, previous, days, unit = 'count' }: {
  current: number;
  previous: number | null;
  days: number;
  unit?: 'count' | 'minutes' | 'points';
}) {
  const t = useTranslations('Overview');
  if (previous === null) {
    return <div className="tile-note">{t('noCompare', { days })}</div>;
  }
  const diff = current - previous;
  if (diff === 0) {
    return <div className="tile-note">{t('same', { days })}</div>;
  }
  return (
    <div className={`tile-note ${diff > 0 ? 'up' : ''}`}>
      <span aria-hidden="true">{diff > 0 ? '↑' : '↓'} </span>
      <span className="srOnly">{diff > 0 ? t('up') : t('down')} </span>
      {t(`delta.${unit}`, { diff: Math.abs(diff), days })}
    </div>
  );
}

export function CustomDashboard() {
  const t = useTranslations('Overview');
  const format = useFormatter();
  const dayLabel = (key: string) => format.dateTime(new Date(`${key}T00:00:00`), { month: 'short', day: 'numeric' });
  const [range, setRange] = useState<OverviewRange>(30);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [res, usage] = await Promise.all([fetch('/api/analytics/overview'), loadMonthlyUsage()]);
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: 'signed-out' });
          return;
        }
        if (!res.ok) throw new Error(`analytics overview: ${res.status}`);
        const overview = (await res.json()) as OverviewResponse;
        if (!cancelled) setState({ status: 'ready', overview, usage });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const summary = useMemo(
    () => (state.status === 'ready' ? summarizeOverview(state.overview, range) : null),
    [state, range]
  );
  const hasActivity = state.status === 'ready' && hasAnyActivity(state.overview);

  const activityData = summary?.buckets.map((bucket) => ({ ...bucket, label: dayLabel(bucket.start) })) ?? [];
  const scoreData = summary?.scores.map((point, index) => ({
    key: index,
    label: format.dateTime(new Date(point.at), { month: 'short', day: 'numeric' }),
    score: point.score,
  })) ?? [];
  // CSV columns in the user's language.
  const exportRows = summary?.buckets.map((bucket) => ({
    [t('csvPeriod')]: bucket.start,
    [t('liveSessions')]: bucket.liveSessions,
    [t('liveMinutes')]: bucket.liveMinutes,
    [t('practiceInterviews')]: bucket.practiceInterviews,
  })) ?? [];

  return (
    <section className="card" id="analytics-overview" aria-labelledby="analytics-overview-title">
      <div className="cardInner stack">
        <div className="overview-header">
          <h2 className="cardTitle" id="analytics-overview-title">{t('title')}</h2>
          {hasActivity && (
            <div className="range-selector" role="group" aria-label={t('range')}>
              {OVERVIEW_RANGES.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={range === days ? 'active' : ''}
                  aria-pressed={range === days}
                  onClick={() => setRange(days)}
                >
                  {t('days', { days })}
                </button>
              ))}
            </div>
          )}
        </div>

        {state.status === 'loading' && (
          <p className="small" role="status">{t('loading')}</p>
        )}

        {state.status === 'signed-out' && (
          <div className="empty-state">
            <p className="help">{t('signedOut')}</p>
            <div>
              <Link className="button" href="/auth">{t('signIn')}</Link>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="empty-state">
            <p className="error" role="alert">{t('failed')}</p>
            <div>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setState({ status: 'loading' });
                  setAttempt((n) => n + 1);
                }}
              >
                {t('retry')}
              </button>
            </div>
          </div>
        )}

        {state.status === 'ready' && !hasActivity && (
          <div className="empty-state">
            <p className="empty-title">{t('emptyTitle')}</p>
            <p className="help">{t('emptyBody')}</p>
            <div className="row">
              <Link className="button buttonPrimary" href="/interview">{t('startPractice')}</Link>
              <Link className="button" href="/copilot/live">{t('openLive')}</Link>
            </div>
          </div>
        )}

        {state.status === 'ready' && hasActivity && summary && (
          <>
            <div className="tiles">
              <div className="tile">
                <div className="tile-label">{t('liveSessions')}</div>
                <div className="tile-value">{format.number(summary.current.liveSessions)}</div>
                <Delta current={summary.current.liveSessions} previous={summary.previous.liveSessions} days={range} />
              </div>
              <div className="tile">
                <div className="tile-label">{t('liveMinutesBilled')}</div>
                <div className="tile-value">{format.number(summary.current.liveMinutes)}</div>
                <Delta current={summary.current.liveMinutes} previous={summary.previous.liveMinutes} days={range} unit="minutes" />
              </div>
              <div className="tile">
                <div className="tile-label">{t('practiceInterviews')}</div>
                <div className="tile-value">{format.number(summary.current.practiceInterviews)}</div>
                <Delta current={summary.current.practiceInterviews} previous={summary.previous.practiceInterviews} days={range} />
              </div>
              <div className="tile">
                <div className="tile-label">{t('averageScore')}</div>
                <div className="tile-value">
                  {summary.current.averageScore ?? '—'}
                  {summary.current.averageScore !== null && <span className="tile-unit"> / 100</span>}
                </div>
                {summary.current.averageScore === null ? (
                  <div className="tile-note">{t('noScores')}</div>
                ) : (
                  <Delta current={summary.current.averageScore} previous={summary.previous.averageScore} days={range} unit="points" />
                )}
              </div>
              <div className="tile">
                <div className="tile-label">{t('copilotMonth')}</div>
                {state.usage ? (
                  <>
                    <div className="tile-value">
                      {format.number(state.usage.used)}
                      {state.usage.limit > 0 && <span className="tile-unit"> {t('ofLimit', { limit: format.number(state.usage.limit) })}</span>}
                    </div>
                    {state.usage.limit > 0 ? (
                      <div
                        className="progressBar meter"
                        role="meter"
                        aria-label={t('copilotMeter')}
                        aria-valuemin={0}
                        aria-valuemax={state.usage.limit}
                        aria-valuenow={state.usage.used}
                      >
                        <div
                          className="progressBarFill"
                          style={{ width: `${Math.min((state.usage.used / state.usage.limit) * 100, 100)}%` }}
                        />
                      </div>
                    ) : (
                      <div className="tile-note">{t('noAllowance')}</div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="tile-value">—</div>
                    <div className="tile-note">{t('usageUnavailable')}</div>
                  </>
                )}
              </div>
            </div>

            <div className="charts">
              <div className="chart-panel">
                <h3>{summary.bucketDays === 7 ? t('weekly') : t('daily')}</h3>
                {summary.current.liveSessions + summary.current.practiceInterviews === 0 ? (
                  <p className="chart-empty">{t('chartEmpty', { days: range })}</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={activityData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="label" tickLine={false} minTickGap={12} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: 'var(--ice-soft)' }}
                        labelFormatter={(label) => (summary.bucketDays === 7 ? t('weekOf', { date: String(label) }) : String(label))}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        formatter={(value) => <span style={{ color: 'var(--paper)' }}>{value}</span>}
                      />
                      <Bar dataKey="liveSessions" name={t('liveSessions')} fill="var(--ember)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                      <Bar dataKey="practiceInterviews" name={t('practiceInterviews')} fill="var(--ice)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="chart-panel">
                <h3>{t('scores')}</h3>
                {scoreData.length === 0 ? (
                  <p className="chart-empty">{t('scoresEmpty', { days: range })}</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={scoreData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="label" tickLine={false} minTickGap={12} />
                      <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => [`${value} / 100`, t('score')]} />
                      <Line
                        type="monotone"
                        dataKey="score"
                        name={t('score')}
                        stroke="var(--ember)"
                        strokeWidth={2}
                        dot={{ r: 4, fill: 'var(--ember)', stroke: 'var(--well)', strokeWidth: 2 }}
                        activeDot={{ r: 6, stroke: 'var(--well)', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <details className="table-view">
              <summary>{t('table')}</summary>
              <table>
                <caption className="srOnly">{t('tableCaption', { days: range })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{summary.bucketDays === 7 ? t('weekColumn') : t('dayColumn')}</th>
                    <th scope="col">{t('liveSessions')}</th>
                    <th scope="col">{t('liveMinutes')}</th>
                    <th scope="col">{t('practiceInterviews')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.buckets.map((bucket) => (
                    <tr key={bucket.start}>
                      <th scope="row">{dayLabel(bucket.start)}</th>
                      <td>{bucket.liveSessions}</td>
                      <td>{bucket.liveMinutes}</td>
                      <td>{bucket.practiceInterviews}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            <div className="overview-footer">
              <p className="small">
                {state.overview.truncated ? t('truncated') : t('exact')}
              </p>
              <ExportButton
                data={exportRows}
                elementId="analytics-overview"
                filename={`activity-last-${range}-days`}
                title={t('title')}
              />
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .overview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .range-selector {
          display: flex;
          gap: 4px;
          background: var(--well);
          border: 1px solid var(--line);
          padding: 3px;
          border-radius: var(--radius-sm);
        }

        .range-selector button {
          min-height: 32px;
          padding: 0 12px;
          border: none;
          background: transparent;
          color: var(--mist);
          border-radius: 7px;
          font: inherit;
          font-size: 13px;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
        }

        .range-selector button:hover {
          color: var(--paper);
        }

        .range-selector button.active {
          background: var(--deck-2);
          color: var(--paper);
        }

        .empty-state {
          display: grid;
          gap: 12px;
          padding: 8px 0;
        }

        .empty-state p {
          margin: 0;
        }

        .empty-title {
          font-weight: 600;
          color: var(--paper);
        }

        .tiles {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 12px;
        }

        .tile {
          display: grid;
          align-content: start;
          gap: 6px;
          background: var(--well);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 14px 16px;
        }

        .tile-label {
          font-size: 13px;
          color: var(--mist);
        }

        .tile-value {
          font-size: 1.6rem;
          font-weight: 600;
          color: var(--paper);
          font-variant-numeric: tabular-nums;
          line-height: 1.15;
        }

        .tile-unit {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--mist);
        }

        /* Global: Delta renders these outside this component's scope. */
        .tile :global(.tile-note) {
          font-size: 12.5px;
          color: var(--mist);
        }

        .tile :global(.tile-note.up) {
          color: var(--live-text);
        }

        /* The tile is already the well colour, so the track steps up one. */
        .meter {
          background: var(--line);
          margin-top: 4px;
        }

        .charts {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        @media (min-width: 900px) {
          .charts {
            grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
          }
        }

        .chart-panel {
          background: var(--well);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 16px;
          min-width: 0;
        }

        .chart-panel h3 {
          font-size: 15px;
          font-weight: 600;
          margin: 0 0 12px;
        }

        .chart-empty {
          margin: 0;
          min-height: 120px;
          display: flex;
          align-items: center;
          font-size: 14px;
          color: var(--mist);
          line-height: 1.5;
        }

        .table-view summary {
          cursor: pointer;
          font-size: 14px;
          color: var(--mist);
        }

        .table-view table {
          width: 100%;
          margin-top: 10px;
          border-collapse: collapse;
          font-size: 13.5px;
          font-variant-numeric: tabular-nums;
        }

        .table-view th,
        .table-view td {
          padding: 6px 10px;
          border-bottom: 1px solid var(--line);
          text-align: right;
        }

        .table-view th:first-child {
          text-align: left;
        }

        .table-view thead th {
          color: var(--mist);
          font-weight: 500;
        }

        .overview-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .overview-footer p {
          margin: 0;
        }
      `}</style>
    </section>
  );
}
