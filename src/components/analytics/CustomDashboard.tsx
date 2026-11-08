'use client';

import { Link } from '@/i18n/routing';
import { useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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

/** A limit counts as nearly used up from 80%: only then does the meter turn red. */
const NEAR_LIMIT = 0.8;
/** The scores list shows the latest few; the table and CSV carry the rest. */
const SCORES_SHOWN = 6;

/** This month's live-copilot minutes from /api/usage, or null when it can't say. */
async function loadMonthlyUsage(signal?: AbortSignal): Promise<MonthlyUsage | null> {
  try {
    const res = await fetch('/api/usage', { signal });
    if (!res.ok) return null;
    const json = await res.json();
    const used = json?.usage?.copilot_minutes_monthly;
    const limit = json?.limits?.copilot_minutes_monthly;
    return typeof used === 'number' && typeof limit === 'number' ? { used, limit } : null;
  } catch {
    return null;
  }
}

/** A change against the previous period. Only a score gets colour: up is better there. */
function Delta({ current, previous, days, unit = 'count', tone = false }: {
  current: number;
  previous: number | null;
  days: number;
  unit?: 'count' | 'minutes' | 'points';
  tone?: boolean;
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
    <div className={`tile-note ${tone ? (diff > 0 ? 'up' : 'down') : ''}`}>
      <span aria-hidden="true">{diff > 0 ? '↑' : '↓'} </span>
      <span className="srOnly">{diff > 0 ? t('up') : t('down')} </span>
      {t(`delta.${unit}`, { diff: Math.abs(diff), days })}
    </div>
  );
}

type Bucket = { start: string; label: string; liveSessions: number; liveMinutes: number; practiceInterviews: number };

export function CustomDashboard({ intro }: { intro?: string }) {
  const t = useTranslations('Overview');
  const format = useFormatter();
  const dayLabel = (key: string) => format.dateTime(new Date(`${key}T00:00:00`), { month: 'short', day: 'numeric' });
  const [range, setRange] = useState<OverviewRange>(30);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    // Aborted when the effect ends (leaving the page, Retry): a response nobody reads would
    // otherwise keep its request open.
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const [res, usage] = await Promise.all([fetch('/api/analytics/overview', { signal }), loadMonthlyUsage(signal)]);
        if (signal.aborted) return;
        if (res.status === 401) {
          setState({ status: 'signed-out' });
          return;
        }
        if (!res.ok) throw new Error(`analytics overview: ${res.status}`);
        const overview = (await res.json()) as OverviewResponse;
        if (!signal.aborted) setState({ status: 'ready', overview, usage });
      } catch {
        if (!signal.aborted) setState({ status: 'error' });
      }
    }
    load();
    return () => controller.abort();
  }, [attempt]);

  const summary = useMemo(
    () => (state.status === 'ready' ? summarizeOverview(state.overview, range) : null),
    [state, range]
  );
  const hasActivity = state.status === 'ready' && hasAnyActivity(state.overview);

  const activityData: Bucket[] = summary?.buckets.map((bucket) => ({ ...bucket, label: dayLabel(bucket.start) })) ?? [];
  const recentScores = [...(summary?.scores ?? [])].reverse().slice(0, SCORES_SHOWN);
  // CSV columns in the user's language.
  const exportRows = summary?.buckets.map((bucket) => ({
    [t('csvPeriod')]: bucket.start,
    [t('liveSessions')]: bucket.liveSessions,
    [t('liveMinutes')]: bucket.liveMinutes,
    [t('practiceInterviews')]: bucket.practiceInterviews,
  })) ?? [];
  const usage = state.status === 'ready' ? state.usage : null;
  const usageShare = usage && usage.limit > 0 ? Math.min(usage.used / usage.limit, 1) : 0;

  return (
    <section className="overview" id="analytics-overview" aria-labelledby="analytics-overview-title">
      <div className="overview-header">
        <div>
          <h2 className="overview-title" id="analytics-overview-title">{t('title')}</h2>
          {intro ? <p className="overview-intro">{intro}</p> : null}
        </div>
        {hasActivity && summary && (
          <div className="controls">
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
            <ExportButton
              data={exportRows}
              filename={`activity-last-${range}-days`}
              title={t('title')}
            />
          </div>
        )}
      </div>

      {state.status === 'loading' && (
        <p className="status-line" role="status">{t('loading')}</p>
      )}

      {state.status === 'signed-out' && (
        <div className="emptyState">
          <p>{t('signedOut')}</p>
          <Link className="button" href="/auth">{t('signIn')}</Link>
        </div>
      )}

      {state.status === 'error' && (
        <div className="emptyState">
          <p role="alert">{t('failed')}</p>
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
      )}

      {state.status === 'ready' && !hasActivity && (
        <div className="emptyState first-run">
          <p className="empty-title">{t('emptyTitle')}</p>
          <p>{t('emptyBody')}</p>
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
                <Delta current={summary.current.averageScore} previous={summary.previous.averageScore} days={range} unit="points" tone />
              )}
            </div>
          </div>

          <div className="panels">
            <div className="card chart-card">
              <div className="cardInner">
                <div className="chart-head">
                  <h3 className="panel-title">{summary.bucketDays === 7 ? t('weekly') : t('daily')}</h3>
                  <ul className="legend" aria-hidden="true">
                    <li><span className="swatch live" />{t('liveSessions')}</li>
                    <li><span className="swatch practice" />{t('practiceInterviews')}</li>
                  </ul>
                </div>
                {summary.current.liveSessions + summary.current.practiceInterviews === 0 ? (
                  <p className="chart-empty">{t('chartEmpty', { days: range })}</p>
                ) : (
                  <div className="chart-box" aria-hidden="true">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={activityData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="24%">
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tickMargin={8} interval="preserveStartEnd" />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tickCount={4} />
                        <Tooltip
                          cursor={{ fill: 'rgba(237, 237, 237, 0.04)' }}
                          isAnimationActive={false}
                          content={({ active, payload }) => {
                            const bucket = active && payload?.length ? (payload[0].payload as Bucket) : null;
                            if (!bucket) return null;
                            return (
                              <div className="chart-tip">
                                <div className="chart-tip-label">
                                  {summary.bucketDays === 7 ? t('weekOf', { date: bucket.label }) : bucket.label}
                                </div>
                                <div className="chart-tip-row">
                                  <span className="key live" />
                                  <strong>{bucket.liveSessions}</strong> {t('liveSessions')}
                                </div>
                                <div className="chart-tip-row">
                                  <span className="key practice" />
                                  <strong>{bucket.practiceInterviews}</strong> {t('practiceInterviews')}
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="practiceInterviews" stackId="activity" name={t('practiceInterviews')} fill="var(--text-3)" fillOpacity={0.5} maxBarSize={24} isAnimationActive={false} />
                        <Bar
                          dataKey="liveSessions"
                          stackId="activity"
                          name={t('liveSessions')}
                          fill="var(--accent)"
                          stroke="var(--surface)"
                          strokeWidth={2}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={24}
                          isAnimationActive={false}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            <div className="side">
              <div className="card">
                <div className="cardInner">
                  <h3 className="panel-title">{t('scores')}</h3>
                  {recentScores.length === 0 ? (
                    <p className="chart-empty small-empty">{t('scoresEmpty', { days: range })}</p>
                  ) : (
                    <ol className="score-list">
                      {recentScores.map((point) => (
                        <li key={point.at}>
                          <span className="score-date">{format.dateTime(new Date(point.at), { month: 'short', day: 'numeric' })}</span>
                          <span className="score-track" aria-hidden="true">
                            <span className="score-fill" style={{ width: `${Math.max(0, Math.min(point.score, 100))}%` }} />
                          </span>
                          <span className="score-value">{point.score}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="tile usage-tile">
                  <div className="tile-label">{t('copilotMonth')}</div>
                  {usage ? (
                    <>
                      <div className="tile-value">
                        {format.number(usage.used)}
                        {usage.limit > 0 && <span className="tile-unit"> {t('ofLimit', { limit: format.number(usage.limit) })}</span>}
                      </div>
                      {usage.limit > 0 ? (
                        <div
                          className="meter"
                          role="meter"
                          aria-label={t('copilotMeter')}
                          aria-valuemin={0}
                          aria-valuemax={usage.limit}
                          aria-valuenow={usage.used}
                        >
                          <div className={`meter-fill ${usageShare >= NEAR_LIMIT ? 'near' : ''}`} style={{ width: `${usageShare * 100}%` }} />
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
            </div>
          </div>

          <details className="table-view">
            <summary>{t('table')}</summary>
            <table className="wide-table">
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
            {/* Phones: the same rows as a list. */}
            <ul className="narrow-list" aria-label={t('tableCaption', { days: range })}>
              {summary.buckets.map((bucket) => (
                <li key={bucket.start}>
                  <span className="narrow-date">{dayLabel(bucket.start)}</span>
                  <span className="narrow-values">
                    {t('liveSessions')} {bucket.liveSessions} · {t('liveMinutes')} {bucket.liveMinutes} · {t('practiceInterviews')} {bucket.practiceInterviews}
                  </span>
                </li>
              ))}
            </ul>
          </details>

          <p className="footnote">
            {state.overview.truncated ? t('truncated') : t('exact')}
          </p>
        </>
      )}

      <style jsx>{`
        .overview {
          display: grid;
          gap: 24px;
        }

        .overview-header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: flex-end;
          gap: 12px 24px;
        }

        .overview-title {
          margin: 0;
          font-size: 15px;
          font-weight: 500;
        }

        .overview-intro {
          margin: 4px 0 0;
          font-size: 13px;
          color: var(--text-3);
        }

        .controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 12px;
        }

        .range-selector {
          display: inline-flex;
          gap: 2px;
          padding: 2px;
          border-radius: var(--radius-control);
          border: 1px solid var(--hairline);
          background: var(--sunken);
        }

        .range-selector button {
          min-height: 30px;
          padding: 0 12px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: var(--text-2);
          font: inherit;
          font-size: 13px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
          transition:
            background-color var(--dur-fast) var(--ease),
            color var(--dur-fast) var(--ease);
        }

        .range-selector button:hover {
          color: var(--text-1);
        }

        .range-selector button.active {
          background: var(--raised);
          color: var(--text-1);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }

        .status-line {
          margin: 0;
          font-size: 14px;
          color: var(--text-2);
        }

        .emptyState p {
          margin: 0;
        }

        .first-run {
          padding: 32px;
        }

        .empty-title {
          font-size: 15px;
          font-weight: 500;
          color: var(--text-1);
        }

        /* Four figures in one quiet row */
        .tiles {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .tile {
          display: grid;
          align-content: start;
          gap: 4px;
          min-width: 0;
          padding: 0 24px;
          border-left: 1px solid var(--hairline);
        }

        .tiles .tile:first-child {
          padding-left: 0;
          border-left: 0;
        }

        .tile-label {
          font-size: 13px;
          line-height: 18px;
          color: var(--text-2);
        }

        .tile-value {
          font-size: 28px;
          font-weight: 500;
          line-height: 36px;
          letter-spacing: -0.01em;
          color: var(--text-1);
          font-variant-numeric: tabular-nums;
        }

        .tile-unit {
          font-size: 14px;
          font-weight: 400;
          letter-spacing: 0;
          color: var(--text-3);
        }

        /* Global: Delta renders these outside this component's scope. */
        .overview :global(.tile-note) {
          font-size: 13px;
          line-height: 18px;
          color: var(--text-3);
        }

        .overview :global(.tile-note.up) {
          color: var(--positive-text);
        }

        .overview :global(.tile-note.down) {
          color: var(--negative-text);
        }

        /* The main chart, and the smaller blocks beside it */
        .panels {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 16px;
          align-items: start;
        }

        @media (min-width: 1100px) {
          .panels {
            grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
            gap: 24px;
          }
        }

        .side {
          display: grid;
          gap: 16px;
          min-width: 0;
        }

        .chart-card {
          min-width: 0;
        }

        .chart-head {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px 16px;
          margin-bottom: 16px;
        }

        .panel-title {
          margin: 0;
          font-size: 15px;
          font-weight: 500;
        }

        .side .panel-title {
          margin-bottom: 12px;
        }

        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 16px;
          margin: 0;
          padding: 0;
          list-style: none;
          font-size: 13px;
          color: var(--text-2);
        }

        .legend li {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .swatch {
          width: 8px;
          height: 8px;
          border-radius: 2px;
        }

        .swatch.live,
        .key.live {
          background: var(--accent);
        }

        .swatch.practice,
        .key.practice {
          background: color-mix(in srgb, var(--text-3) 50%, var(--surface));
        }

        .chart-box {
          height: 280px;
          margin-left: -4px;
        }

        .chart-empty {
          margin: 0;
          min-height: 160px;
          display: flex;
          align-items: center;
          padding: 24px;
          border-radius: var(--radius-row);
          background: var(--sunken);
          font-size: 14px;
          line-height: 1.5;
          color: var(--text-2);
        }

        .small-empty {
          min-height: 0;
          padding: 16px;
        }

        .chart-tip {
          display: grid;
          gap: 4px;
          padding: 8px 10px;
          border-radius: var(--radius-control);
          border: 1px solid var(--hairline-strong);
          background: var(--raised);
          box-shadow: var(--float);
          font-size: 13px;
          color: var(--text-2);
        }

        .chart-tip-label {
          font-family: var(--font-code);
          font-size: 12px;
          color: var(--text-3);
        }

        .chart-tip-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .chart-tip-row strong {
          font-weight: 500;
          color: var(--text-1);
          font-variant-numeric: tabular-nums;
        }

        .key {
          width: 10px;
          height: 2px;
          border-radius: 1px;
        }

        /* Latest practice scores, with thin neutral bars */
        .score-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
        }

        .score-list li {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr) 32px;
          align-items: center;
          gap: 12px;
          min-height: 36px;
          border-top: 1px solid var(--hairline);
        }

        .score-date {
          font-size: 13px;
          color: var(--text-3);
          font-variant-numeric: tabular-nums;
        }

        .score-track {
          height: 4px;
          border-radius: 2px;
          background: var(--raised);
          overflow: hidden;
        }

        .score-fill {
          display: block;
          height: 100%;
          border-radius: 2px;
          background: var(--text-3);
        }

        .score-value {
          font-size: 14px;
          font-weight: 500;
          text-align: right;
          color: var(--text-1);
          font-variant-numeric: tabular-nums;
        }

        .tile.usage-tile {
          padding: 20px;
          border-left: 0;
        }

        @media (min-width: 900px) {
          .tile.usage-tile {
            padding: 24px;
          }
        }

        .usage-tile .tile-value {
          font-size: 24px;
          line-height: 32px;
        }

        .meter {
          height: 4px;
          margin-top: 8px;
          border-radius: 2px;
          background: var(--raised);
          overflow: hidden;
        }

        .meter-fill {
          height: 100%;
          border-radius: 2px;
          background: var(--text-3);
        }

        .meter-fill.near {
          background: var(--negative);
        }

        /* Table view: a table on wide screens, a list on phones */
        .table-view summary {
          font-size: 14px;
          color: var(--text-2);
        }

        .table-view summary:hover {
          color: var(--text-1);
        }

        .wide-table {
          width: 100%;
          margin-top: 12px;
          border-collapse: collapse;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }

        .wide-table th,
        .wide-table td {
          padding: 8px 12px;
          border-bottom: 1px solid var(--hairline);
          text-align: right;
        }

        .wide-table th:first-child {
          padding-left: 0;
          text-align: left;
        }

        .wide-table thead th {
          color: var(--text-3);
          font-weight: 500;
        }

        .wide-table tbody th {
          font-weight: 400;
          color: var(--text-2);
        }

        .narrow-list {
          display: none;
          margin: 12px 0 0;
          padding: 0;
          list-style: none;
        }

        .narrow-list li {
          display: grid;
          gap: 2px;
          padding: 8px 0;
          border-bottom: 1px solid var(--hairline);
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }

        .narrow-date {
          color: var(--text-1);
        }

        .narrow-values {
          color: var(--text-3);
        }

        .footnote {
          margin: 0;
          font-size: 13px;
          color: var(--text-3);
        }

        @media (max-width: 767px) {
          .tiles {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            row-gap: 16px;
          }

          .tile {
            padding: 0 16px;
          }

          .tiles .tile:nth-child(odd) {
            padding-left: 0;
            border-left: 0;
          }

          .tiles .tile:nth-child(n + 3) {
            padding-top: 16px;
            border-top: 1px solid var(--hairline);
          }

          .tile-value {
            font-size: 24px;
            line-height: 32px;
          }

          .tile.usage-tile {
            padding: 16px;
          }

          .chart-box {
            height: 220px;
          }

          .first-run {
            padding: 24px 20px;
          }
        }

        @media (max-width: 559px) {
          .wide-table {
            display: none;
          }

          .narrow-list {
            display: grid;
          }
        }
      `}</style>
    </section>
  );
}
