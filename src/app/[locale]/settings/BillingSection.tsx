'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BillingActions } from '@/components/BillingActions';
import { Skeleton } from '@/components/Skeleton';
import { SettingRow, SettingsGroup, settingsStyles as styles } from './SettingsUI';

type Usage = {
  plan: string;
  isPro: boolean;
  limits: Record<MeterKey, number>;
  usage: Record<MeterKey, number>;
};

type MeterKey =
  | 'copilot_minutes_monthly'
  | 'copilot_session_minutes'
  | 'copilot_daily_minutes'
  | 'smart_mode_minutes_monthly'
  | 'resume_deep_reviews_monthly';

/** What /api/usage counts, in the order people think about it; reviews are a count, the rest minutes. */
const METERS: Array<{ key: MeterKey; label: string; unit: 'minutes' | 'count' }> = [
  { key: 'copilot_minutes_monthly', label: 'copilotMonth', unit: 'minutes' },
  { key: 'copilot_daily_minutes', label: 'copilotToday', unit: 'minutes' },
  { key: 'copilot_session_minutes', label: 'perSession', unit: 'minutes' },
  { key: 'smart_mode_minutes_monthly', label: 'smartMonth', unit: 'minutes' },
  { key: 'resume_deep_reviews_monthly', label: 'reviewsMonth', unit: 'count' },
];

/** Settings → Billing & usage: the plan, this month's usage against its limits, and the billing actions. */
export function BillingSection() {
  const t = useTranslations('Billing');
  const [data, setData] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/usage').catch(() => null);
      const json = res?.ok ? ((await res.json().catch(() => null)) as Usage | null) : null;
      if (cancelled) return;
      if (json?.limits && json.usage) setData(json);
      else setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <SettingsGroup>
        <div className={styles.block}>
          <p className={styles.inlineError} role="alert">
            {t('usageFailed')}
          </p>
        </div>
      </SettingsGroup>
    );
  }

  if (!data) {
    return (
      <SettingsGroup>
        <div className={styles.skeletonRows} role="status" aria-label={t('loading')}>
          <Skeleton width="40%" height="16px" />
          <Skeleton width="100%" height="4px" />
          <Skeleton width="100%" height="4px" />
          <Skeleton width="100%" height="4px" />
        </div>
      </SettingsGroup>
    );
  }

  const planKey = data.plan.toLowerCase();
  const planName = t.has(`plans.${planKey}`) ? t(`plans.${planKey}`) : data.plan;

  return (
    <SettingsGroup>
      <SettingRow
        layout={data.isPro ? 'inline' : 'split'}
        label={t('planName', { plan: planName })}
        help={data.isPro ? t('manageHelp') : t('proLimits')}
      >
        <div className={styles.planCell}>
          <BillingActions isPro={data.isPro} compact />
        </div>
      </SettingRow>
      <div className={styles.block}>
        <ul className={styles.meters} aria-label={t('usageLabel')}>
          {METERS.map((meter) => {
            const used = data.usage[meter.key] ?? 0;
            const limit = data.limits[meter.key] ?? 0;
            const share = limit > 0 ? Math.min(used / limit, 1) : 0;
            const value = t(meter.unit === 'minutes' ? 'usage.minutes' : 'usage.count', { used, limit });
            return (
              <li key={meter.key} className={styles.meter}>
                <span className={styles.meterLabel}>{t(`usage.${meter.label}`)}</span>
                <span
                  className={styles.meterTrack}
                  role="meter"
                  aria-label={t(`usage.${meter.label}`)}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={Math.min(used, limit)}
                  aria-valuetext={value}
                >
                  <span className={styles.meterFill} data-near={share >= 0.8} style={{ transform: `scaleX(${share})` }} />
                </span>
                <span className={styles.meterValue}>{value}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </SettingsGroup>
  );
}
