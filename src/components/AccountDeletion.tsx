'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';

/** Typed to confirm; it stays the same in every language. */
const CONFIRM_WORD = 'DELETE';

export function AccountDeletion() {
  const t = useTranslations('AccountDeletion');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  async function handleDelete() {
    setError(null);
    setSaving(true);

    try {
      const res = await fetch('/api/settings/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirm_email: email,
          reason: reason || undefined,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof json.error === 'string' && t.has(`errors.${json.error}`) ? t(`errors.${json.error}`) : t('failed'));
      }

      setSuccess(true);
      
      // Sign out and redirect after a short delay
      setTimeout(async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/');
        router.refresh();
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setSaving(false);
    }
  }

  if (success) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle" style={{ color: 'var(--success)' }}>
            {t('deletedTitle')}
          </h2>
          <p>{t('deletedBody')}</p>
        </div>
      </div>
    );
  }

  if (!showWarning) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">{t('title')}</h2>
          <p className="cardDesc">{t('desc')}</p>
          
          <div 
            style={{ 
              background: 'var(--alert-soft)', 
              border: '1px solid rgba(255, 107, 107, 0.35)',
              borderRadius: 12, 
              padding: 16,
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--alert-text)' }}>
              {t('deletes')}
            </p>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>{t('deletesProfile')}</li>
              <li>{t('deletesSessions')}</li>
              <li>{t('deletesDocuments')}</li>
              <li>{t('deletesUsage')}</li>
            </ul>
          </div>

          <button
            className="button buttonDanger"
            onClick={() => setShowWarning(true)}
            style={{ alignSelf: 'flex-start' }}
          >
            {t('start')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <h2 className="cardTitle" style={{ color: 'var(--error)' }}>
          {t('confirmTitle')}
        </h2>
        <p className="cardDesc">{t('confirmDesc', { word: CONFIRM_WORD })}</p>

        <div className="stack" style={{ gap: 16 }}>
          <label className="label">
            {t('email')}
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
            />
          </label>

          <label className="label">
            {t('reason')}
            <textarea
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </label>

          <label className="label">
            {t.rich('typeWord', { word: CONFIRM_WORD, strong: (chunks) => <strong>{chunks}</strong> })}
            <input
              className="input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
            />
          </label>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            className="button"
            onClick={() => {
              setShowWarning(false);
              setConfirmText('');
            }}
            disabled={saving}
          >
            {t('cancel')}
          </button>
          <button
            className="button buttonDanger"
            onClick={handleDelete}
            disabled={saving || email !== email.toLowerCase() || confirmText !== CONFIRM_WORD}
          >
            {saving ? t('deleting') : t('confirm')}
          </button>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
