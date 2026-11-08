'use client';

import { useId, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { settingsStyles } from '@/app/[locale]/settings/SettingsUI';

const RETURNS = ['success', 'cancelled'];

/**
 * Upgrade (Stripe Checkout) or manage billing (Stripe's portal); both leave the app and come back here.
 * `compact`: inside a Settings row, whose help already says what the button does.
 */
export function BillingActions({ isPro, compact = false }: { isPro: boolean; compact?: boolean }) {
  const t = useTranslations('Billing');
  // The page's [locale] segment; Stripe sends the user back to the same language.
  const locale = useParams<{ locale?: string }>()?.locale ?? 'en';
  const returned = useSearchParams()?.get('billing') ?? '';
  const [currency, setCurrency] = useState<'usd' | 'eur'>('usd');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currencyId = useId();

  async function go(path: '/api/billing/checkout' | '/api/billing/portal', body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, locale }),
      });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        setError(json.error && t.has(`errors.${json.error}`) ? t(`errors.${json.error}`) : t('unreachable'));
        setBusy(false);
        return;
      }
      window.location.assign(json.url);
    } catch {
      setError(t('unreachable'));
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {RETURNS.includes(returned) ? (
        <p className="small" role="status" style={{ margin: 0 }}>
          {t(`returned.${returned}`)}
        </p>
      ) : null}

      {isPro ? (
        <div className="row">
          <button className="button" type="button" disabled={busy} onClick={() => void go('/api/billing/portal', {})}>
            {busy ? t('opening') : t('manage')}
          </button>
          {compact ? null : <span className="small help">{t('manageHelp')}</span>}
        </div>
      ) : (
        <>
          <div className="row" style={{ flexWrap: compact ? 'nowrap' : 'wrap' }}>
            <label className={compact ? 'srOnly' : 'small'} htmlFor={currencyId}>
              {t('payIn')}
            </label>
            <select
              id={currencyId}
              className="select"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as 'usd' | 'eur')}
              disabled={busy}
              style={{ width: 'auto', minWidth: 0, flex: compact ? '1 1 auto' : '0 1 auto' }}
            >
              <option value="usd">{t('currencies.usd')}</option>
              <option value="eur">{t('currencies.eur')}</option>
            </select>
            <button
              className="button buttonPrimary"
              type="button"
              disabled={busy}
              style={{ flexShrink: 0 }}
              onClick={() => void go('/api/billing/checkout', { currency })}
            >
              {busy ? t('openingCheckout') : t('upgrade')}
            </button>
            {compact ? null : <span className="small help">{t('checkoutHelp')}</span>}
          </div>
          {compact ? <span className="help">{t('checkoutHelp')}</span> : null}
        </>
      )}

      {error ? (
        <p className={compact ? settingsStyles.inlineError : 'error'} role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
