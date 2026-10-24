'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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

function dayLabel(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Delta({ current, previous, days, unit = '' }: {
  current: number;
  previous: number | null;
  days: number;
  unit?: string;
}) {
  if (previous === null) {
    return <div className="tile-note">Nothing to compare in the previous {days} days</div>;
  }
  const diff = current - previous;
  if (diff === 0) {
    return <div className="tile-note">Same as the previous {days} days</div>;
  }
  return (
    <div className={`tile-note ${diff > 0 ? 'up' : ''}`}>
      <span aria-hidden="true">{diff > 0 ? '↑' : '↓'} </span>
      <span className="srOnly">{diff > 0 ? 'Up' : 'Down'} </span>
      {Math.abs(diff)}{unit} vs previous {days} days
    </div>
  );
}

export function CustomDashboard() {
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
        if (!res.ok) throw new Error('Failed to fetch analytics overview');
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
    label: new Date(point.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    score: point.score,
  })) ?? [];
  const exportRows = summary?.buckets.map((bucket) => ({
    period_start: bucket.start,
    live_sessions: bucket.liveSessions,
    live_minutes: bucket.liveMinutes,
    practice_interviews: bucket.practiceInterviews,
  })) ?? [];

  return (
    <section className="card" id="analytics-overview" aria-labelledby="analytics-overview-title">
      <div className="cardInner stack">
        <div className="overview-header">
          <h2 className="cardTitle" id="analytics-overview-title">Your activity</h2>
          {hasActivity && (
            <div className="range-selector" role="group" aria-label="Time range">
              {OVERVIEW_RANGES.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={range === days ? 'active' : ''}
                  aria-pressed={range === days}
                  onClick={() => setRange(days)}
                >
                  {days} days
                </button>
              ))}
            </div>
          )}
        </div>

        {state.status === 'loading' && (
          <p className="small" role="status">Loading your activity…</p>
        )}

        {state.status === 'signed-out' && (
          <div className="empty-state">
            <p className="help">Sign in to see your practice interviews, live sessions and scores.</p>
            <div>
              <Link className="button" href="/auth">Sign in</Link>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="empty-state">
            <p className="error" role="alert">We couldn&apos;t load your activity.</p>
            <div>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setState({ status: 'loading' });
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {state.status === 'ready' && !hasActivity && (
          <div className="empty-state">
            <p className="empty-title">No activity yet</p>
            <p className="help">
              Your numbers appear here after your first practice interview or live session.
            </p>
            <div className="row">
              <Link className="button buttonPrimary" href="/interview">Start a practice interview</Link>
              <Link className="button" href="/copilot/live">Open the live copilot</Link>
            </div>
          </div>
        )}

        {state.status === 'ready' && hasActivity && summary && (
          <>
            <div className="tiles">
              <div className="tile">
                <div className="tile-label">Live sessions</div>
                <div className="tile-value">{summary.current.liveSessions.toLocaleString()}</div>
                <Delta current={summary.current.liveSessions} previous={summary.previous.liveSessions} days={range} />
              </div>
              <div className="tile">
                <div className="tile-label">Live minutes billed</div>
                <div className="tile-value">{summary.current.liveMinutes.toLocaleString()}</div>
                <Delta current={summary.current.liveMinutes} previous={summary.previous.liveMinutes} days={range} unit=" min" />
              </div>
              <div className="tile">
                <div className="tile-label">Practice interviews</div>
                <div className="tile-value">{summary.current.practiceInterviews.toLocaleString()}</div>
                <Delta current={summary.current.practiceInterviews} previous={summary.previous.practiceInterviews} days={range} />
              </div>
              <div className="tile">
                <div className="tile-label">Average score</div>
                <div className="tile-value">
                  {summary.current.averageScore ?? '—'}
                  {summary.current.averageScore !== null && <span className="tile-unit"> / 100</span>}
                </div>
                {summary.current.averageScore === null ? (
                  <div className="tile-note">No scored interviews in this period</div>
                ) : (
                  <Delta current={summary.current.averageScore} previous={summary.previous.averageScore} days={range} unit=" pts" />
                )}
              </div>
              <div className="tile">
                <div className="tile-label">Copilot minutes this month</div>
                {state.usage ? (
                  <>
                    <div className="tile-value">
                      {state.usage.used.toLocaleString()}
                      {state.usage.limit > 0 && <span className="tile-unit"> of {state.usage.limit.toLocaleString()}</span>}
                    </div>
                    {state.usage.limit > 0 ? (
                      <div
                        className="progressBar meter"
                        role="meter"
                        aria-label="Copilot minutes used this month"
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
                      <div className="tile-note">No monthly allowance on record</div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="tile-value">—</div>
                    <div className="tile-note">Monthly usage is unavailable right now</div>
                  </>
                )}
              </div>
            </div>

            <div className="charts">
              <div className="chart-panel">
                <h3>{summary.bucketDays === 7 ? 'Weekly activity' : 'Daily activity'}</h3>
                {summary.current.liveSessions + summary.current.practiceInterviews === 0 ? (
                  <p className="chart-empty">No live sessions or practice interviews in the last {range} days.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={activityData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="label" tickLine={false} minTickGap={12} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: 'var(--ice-soft)' }}
                        labelFormatter={(label) => (summary.bucketDays === 7 ? `Week of ${label}` : String(label))}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={8}
                        formatter={(value) => <span style={{ color: 'var(--paper)' }}>{value}</span>}
                      />
                      <Bar dataKey="liveSessions" name="Live sessions" fill="var(--ember)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                      <Bar dataKey="practiceInterviews" name="Practice interviews" fill="var(--ice)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="chart-panel">
                <h3>Practice scores</h3>
                {scoreData.length === 0 ? (
                  <p className="chart-empty">
                    No scored practice interviews in the last {range} days. A score is added when an interview&apos;s report is generated.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={scoreData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="label" tickLine={false} minTickGap={12} />
                      <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => [`${value} / 100`, 'Score']} />
                      <Line
                        type="monotone"
                        dataKey="score"
                        name="Score"
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
              <summary>View as table</summary>
              <table>
                <caption className="srOnly">Activity in the last {range} days</caption>
                <thead>
                  <tr>
                    <th scope="col">{summary.bucketDays === 7 ? 'Week of' : 'Day'}</th>
                    <th scope="col">Live sessions</th>
                    <th scope="col">Live minutes</th>
                    <th scope="col">Practice interviews</th>
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
                {state.overview.truncated
                  ? 'Counts use your most recent 1,000 records of each kind, so a very busy period may read low.'
                  : 'Counts come straight from your account. Nothing is estimated.'}
              </p>
              <ExportButton
                data={exportRows}
                elementId="analytics-overview"
                filename={`activity-last-${range}-days`}
                label="Export activity"
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
