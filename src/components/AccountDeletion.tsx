'use client';

import { useId, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { SettingRow, SettingsGroup, settingsStyles as styles } from '@/app/[locale]/settings/SettingsUI';

/** Typed to confirm; it stays the same in every language. */
const CONFIRM_WORD = 'DELETE';

/** Settings → Account → Danger zone. Two steps: what goes, then the email and the typed word. */
export function AccountDeletion() {
  const t = useTranslations('AccountDeletion');
  const router = useRouter();
  const ids = { email: useId(), reason: useId(), word: useId(), title: useId() };
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleDelete(event: React.FormEvent) {
    event.preventDefault();
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

      // Sign out and go home after a short pause, so the confirmation can be read.
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
      <SettingsGroup danger>
        <div className={styles.block} role="status">
          <p className={styles.rowLabel}>{t('deletedTitle')}</p>
          <p className={styles.rowHelp}>{t('deletedBody')}</p>
        </div>
      </SettingsGroup>
    );
  }

  if (!confirming) {
    return (
      <SettingsGroup danger>
        <SettingRow layout="inline" label={t('title')} help={t('desc')}>
          <button className="button buttonDanger" type="button" onClick={() => setConfirming(true)}>
            {t('start')}
          </button>
        </SettingRow>
        <div className={styles.block}>
          <p className={styles.rowHelp}>{t('deletes')}</p>
          <ul className={styles.dangerList}>
            <li>{t('deletesProfile')}</li>
            <li>{t('deletesSessions')}</li>
            <li>{t('deletesDocuments')}</li>
            <li>{t('deletesUsage')}</li>
          </ul>
        </div>
      </SettingsGroup>
    );
  }

  return (
    <form className={`${styles.group} ${styles.groupDanger}`} onSubmit={handleDelete} aria-labelledby={ids.title}>
      <div className={styles.block}>
        <div className={styles.form}>
          <div className={styles.rowText}>
            <h3 id={ids.title} className={styles.rowLabel}>
              {t('confirmTitle')}
            </h3>
            <p className={styles.rowHelp}>{t('confirmDesc', { word: CONFIRM_WORD })}</p>
          </div>

          <label className="label" htmlFor={ids.email}>
            {t('email')}
            <input
              id={ids.email}
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              required
            />
          </label>

          <label className="label" htmlFor={ids.reason}>
            {t('reason')}
            <textarea
              id={ids.reason}
              className="textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              rows={3}
            />
          </label>

          <label className="label" htmlFor={ids.word}>
            <span>{t.rich('typeWord', { word: CONFIRM_WORD, strong: (chunks) => <strong className="mono">{chunks}</strong> })}</span>
            <input
              id={ids.word}
              className="input mono"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
            />
          </label>

          {error ? (
            <p className={styles.inlineError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className={styles.groupFooter}>
        <div className={styles.footerActions}>
          <button
            className="button buttonGhost"
            type="button"
            onClick={() => {
              setConfirming(false);
              setConfirmText('');
              setError(null);
            }}
            disabled={saving}
          >
            {t('cancel')}
          </button>
          <button
            className="button buttonDanger"
            type="submit"
            disabled={saving || !email.trim() || email !== email.toLowerCase() || confirmText !== CONFIRM_WORD}
          >
            {saving ? t('deleting') : t('confirm')}
          </button>
        </div>
      </div>
    </form>
  );
}
