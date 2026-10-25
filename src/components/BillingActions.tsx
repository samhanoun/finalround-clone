'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

const BILLING_ERRORS: Record<string, string> = {
  billing_unavailable: 'Billing is not set up on the server yet.',
  already_subscribed: 'You already have Pro. Use Manage billing to change it.',
  no_billing_account: 'There is no billing account for you yet. Upgrade first.',
  rate_limited: 'Too many attempts. Try again in a minute.',
  unauthorized: 'Sign in again, then retry.',
};

const RETURN_NOTES: Record<string, string> = {
  success: 'Thanks! Pro is being activated; it can take a few seconds to show here. Refresh if it hasn’t.',
  cancelled: 'Checkout was cancelled. You haven’t been charged.',
};

/** Upgrade (Stripe Checkout) or manage billing (Stripe's portal); both leave the app and come back here. */
export function BillingActions({ isPro }: { isPro: boolean }) {
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
        setError(BILLING_ERRORS[json.error ?? ''] ?? 'Could not reach billing. Try again.');
        setBusy(false);
        return;
      }
      window.location.assign(json.url);
    } catch {
      setError('Could not reach billing. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {RETURN_NOTES[returned] ? (
        <p className="small" role="status">
          {RETURN_NOTES[returned]}
        </p>
      ) : null}

      {isPro ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="button" type="button" disabled={busy} onClick={() => void go('/api/billing/portal', {})}>
            {busy ? 'Opening…' : 'Manage billing'}
          </button>
          <span className="small help">Change card, see invoices or cancel.</span>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="small" htmlFor="billing-currency">
            Pay in
          </label>
          <select
            id="billing-currency"
            className="input"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as 'usd' | 'eur')}
            disabled={busy}
            style={{ width: 'auto' }}
          >
            <option value="usd">USD ($)</option>
            <option value="eur">EUR (€)</option>
          </select>
          <button
            className="button buttonPrimary"
            type="button"
            disabled={busy}
            onClick={() => void go('/api/billing/checkout', { currency })}
          >
            {busy ? 'Opening checkout…' : 'Upgrade to Pro'}
          </button>
          <span className="small help">Secure checkout by Stripe; you see the price before paying.</span>
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
