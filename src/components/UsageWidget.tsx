'use client';

import { useEffect, useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { BillingActions } from './BillingActions';
import styles from './UsageWidget.module.css';

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

const ROWS = [
  { key: 'copilot_minutes_monthly', label: 'copilotMonth' },
  { key: 'copilot_session_minutes', label: 'perSession' },
  { key: 'copilot_daily_minutes', label: 'copilotToday' },
  { key: 'smart_mode_minutes_monthly', label: 'smartMonth' },
  { key: 'resume_deep_reviews_monthly', label: 'reviewsMonth' },
] as const;

/** A limit counts as nearly used up from 80%: only then does its bar turn red. */
const NEAR_LIMIT = 0.8;

/**
 * Usage this month against the plan's limits. `compact` (Home) keeps to the
 * figures and one secondary billing action; the full version (Settings) adds
 * what Pro raises and the checkout.
 */
export function UsageWidget({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('Usage');
  const format = useFormatter();
  const headingId = useId();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUsage() {
      try {
        const res = await fetch('/api/usage');
        if (!res.ok) throw new Error('usage');
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'usage');
      } finally {
        setLoading(false);
      }
    }
    fetchUsage();
  }, []);

  const planName = data ? (t.has(`plans.${data.plan.toLowerCase()}`) ? t(`plans.${data.plan.toLowerCase()}`) : data.plan) : '';

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className={`cardInner ${styles.inner}`}>
        <div className={styles.head}>
          <h2 className="cardTitle" id={headingId}>
            {t('title')}
          </h2>
          {data ? <span className={styles.plan}>{t('plan', { plan: planName })}</span> : null}
        </div>

        {loading ? (
          <p className={styles.status}>{t('loading')}</p>
        ) : error || !data ? (
          <p className={styles.status} role="alert">
            {t('failed')}
          </p>
        ) : (
          <>
            <ul className={styles.rows}>
              {ROWS.map(({ key, label }) => {
                const used = data.usage[key] ?? 0;
                const limit = data.limits[key] ?? 0;
                const share = limit > 0 ? Math.min(used / limit, 1) : 0;
                return (
                  <li key={key} className={styles.row}>
                    <span className={styles.label}>{t(label)}</span>
                    <span className={styles.value}>
                      {format.number(used)} / {format.number(limit)}
                    </span>
                    <span className={styles.track} aria-hidden="true">
                      <span
                        className={`${styles.fill} ${share >= NEAR_LIMIT ? styles.near : ''}`}
                        style={{ width: `${share * 100}%` }}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>

            {!compact && !data.isPro ? <p className="help">{t('proLimits')}</p> : null}

            {/* Home keeps one Ember button (Start live session), so upgrading happens in Settings. */}
            {compact && !data.isPro ? (
              <div>
                <Link className="button buttonSmall" href="/settings">
                  {t('seePlans')}
                </Link>
              </div>
            ) : (
              <BillingActions isPro={data.isPro} />
            )}
          </>
        )}
      </div>
    </section>
  );
}
