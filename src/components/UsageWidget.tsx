'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('Usage');
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
          <p className="small">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <div className="cardInner">
          <p className="small error">{t('failed')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="cardTitle">{t('title')}</h2>
          <span className={`badge ${data.isPro ? 'badgePro' : 'badgeFree'}`}>
            {t('plan', { plan: t.has(`plans.${data.plan.toLowerCase()}`) ? t(`plans.${data.plan.toLowerCase()}`) : data.plan })}
          </span>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <ProgressBar
            used={data.usage.copilot_minutes_monthly}
            limit={data.limits.copilot_minutes_monthly}
            label={t('copilotMonth')}
          />
          <ProgressBar
            used={data.usage.copilot_session_minutes}
            limit={data.limits.copilot_session_minutes}
            label={t('perSession')}
          />
          <ProgressBar
            used={data.usage.copilot_daily_minutes}
            limit={data.limits.copilot_daily_minutes}
            label={t('copilotToday')}
          />
          <ProgressBar
            used={data.usage.smart_mode_minutes_monthly}
            limit={data.limits.smart_mode_minutes_monthly}
            label={t('smartMonth')}
          />
          <ProgressBar
            used={data.usage.resume_deep_reviews_monthly}
            limit={data.limits.resume_deep_reviews_monthly}
            label={t('reviewsMonth')}
          />
        </div>

        {!data.isPro && (
          <p className="small help">
            {t('proLimits')}
          </p>
        )}

        <BillingActions isPro={data.isPro} />
      </div>
    </div>
  );
}
