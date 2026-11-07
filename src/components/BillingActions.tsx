'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

const RETURNS = ['success', 'cancelled'];

/** Upgrade (Stripe Checkout) or manage billing (Stripe's portal); both leave the app and come back here. */
export function BillingActions({ isPro }: { isPro: boolean }) {
  const t = useTranslations('Billing');
  // The page's [locale] segment; Stripe sends the user back to the same language.
  const locale = useParams<{ locale?: string }>()?.locale ?? 'en';
  const returned = useSearchParams()?.get('billing') ?? '';
  const [currency, setCurrency] = useState<'usd' | 'eur'>('usd');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <p className="small" role="status">
          {t(`returned.${returned}`)}
        </p>
      ) : null}

      {isPro ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="button" type="button" disabled={busy} onClick={() => void go('/api/billing/portal', {})}>
            {busy ? t('opening') : t('manage')}
          </button>
          <span className="small help">{t('manageHelp')}</span>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="small" htmlFor="billing-currency">
            {t('payIn')}
          </label>
          <select
            id="billing-currency"
            className="input"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as 'usd' | 'eur')}
            disabled={busy}
            style={{ width: 'auto' }}
          >
            <option value="usd">{t('currencies.usd')}</option>
            <option value="eur">{t('currencies.eur')}</option>
          </select>
          <button
            className="button buttonPrimary"
            type="button"
            disabled={busy}
            onClick={() => void go('/api/billing/checkout', { currency })}
          >
            {busy ? t('openingCheckout') : t('upgrade')}
          </button>
          <span className="small help">{t('checkoutHelp')}</span>
        </div>
      )}

      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
