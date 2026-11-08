'use client';

import { useId, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { SettingRow, SettingsGroup, settingsStyles as styles } from '@/app/[locale]/settings/SettingsUI';

/** Typed to confirm; it stays the same in every language. */
const CONFIRM_WORD = 'DELETE';

/** How long the confirmation stays on screen before going home. */
const GOODBYE_MS = 2000;

/** Settings → Account → Danger zone. Two steps: what goes, then the email and the typed word. */
export function AccountDeletion() {
  const t = useTranslations('AccountDeletion');
  const router = useRouter();
  const ids = { email: useId(), word: useId(), title: useId() };
  const [email, setEmail] = useState('');
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
        body: JSON.stringify({ confirm_email: email }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(typeof json.error === 'string' && t.has(`errors.${json.error}`) ? t(`errors.${json.error}`) : t('failed'));
      }

      setSuccess(true);

      // The account is gone: this browser's session goes now (even if the tab is closed during the
      // pause), and home follows once the confirmation has been read.
      try {
        await createClient().auth.signOut();
      } catch {
        // The session belonged to the deleted account either way; going home still follows.
      }
      setTimeout(() => {
        router.push('/');
        router.refresh();
      }, GOODBYE_MS);
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
            <li>{t('deletesPlan')}</li>
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
            disabled={saving || !email.trim() || confirmText !== CONFIRM_WORD}
          >
            {saving ? t('deleting') : t('confirm')}
          </button>
        </div>
      </div>
    </form>
  );
}
