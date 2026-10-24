'use client';

import { useEffect, useState } from 'react';
import { BillingActions } from './BillingActions';

interface UsageData {
  plan: string;
  isPro: boolean;
  limits: {
    copilot_minutes_monthly: number;
    copilot_session_minutes: number;
    copilot_daily_minutes: number;
    smart_mode_minutes_monthly: number;
    resume_deep_reviews_monthly: number;
  };
  usage: {
    copilot_minutes_monthly: number;
    copilot_session_minutes: number;
    copilot_daily_minutes: number;
    smart_mode_minutes_monthly: number;
    resume_deep_reviews_monthly: number;
  };
}

function ProgressBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;

  return (
    <div className="usage-row">
      <span className="usage-label">{label}</span>
      <div className="usage-bar-container">
        <div
          className={`usage-bar ${isNearLimit ? 'near-limit' : ''}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="usage-value">
        {used} / {limit}
      </span>
    </div>
  );
}

export function UsageWidget() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUsage() {
      try {
        const res = await fetch('/api/usage');
        if (!res.ok) throw new Error('Failed to fetch usage');
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    fetchUsage();
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner">
          <p className="small">Loading usage...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <div className="cardInner">
          <p className="small error">Failed to load usage data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="cardTitle">Usage this month</h2>
          <span className={`badge ${data.isPro ? 'badgePro' : 'badgeFree'}`}>
            {data.plan} plan
          </span>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <ProgressBar
            used={data.usage.copilot_minutes_monthly}
            limit={data.limits.copilot_minutes_monthly}
            label="Live copilot, this month"
          />
          <ProgressBar
            used={data.usage.copilot_session_minutes}
            limit={data.limits.copilot_session_minutes}
            label="Per session"
          />
          <ProgressBar
            used={data.usage.copilot_daily_minutes}
            limit={data.limits.copilot_daily_minutes}
            label="Live copilot, today"
          />
          <ProgressBar
            used={data.usage.smart_mode_minutes_monthly}
            limit={data.limits.smart_mode_minutes_monthly}
            label="Smart mode, this month"
          />
          <ProgressBar
            used={data.usage.resume_deep_reviews_monthly}
            limit={data.limits.resume_deep_reviews_monthly}
            label="Résumé reviews, this month"
          />
        </div>

        {!data.isPro && (
          <p className="small help">
            Pro raises the limits to 400 minutes a month, 30-minute sessions, 45 minutes a day, 80 Smart mode minutes and 10 résumé reviews a month.
          </p>
        )}

        <BillingActions isPro={data.isPro} />
      </div>
    </div>
  );
}
