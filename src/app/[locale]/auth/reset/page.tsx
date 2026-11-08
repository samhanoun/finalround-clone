'use client';

import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { AuthShell } from '../AuthShell';
import styles from '../auth.module.css';

/** Where the password reset email lands (through /api/auth/callback, which signs the user in). */
export default function ResetPasswordPage() {
  const t = useTranslations('ResetPassword');
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setSignedIn(Boolean(data.user)));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t('tooShort'));
    // nosemgrep: ajinabraham.njsscan.crypto.timing_attack_node.node_timing_attack -- the two fields the person just typed, compared in their own browser
    if (password !== confirm) return setError(t('mismatch'));
    setSaving(true);
    const { error } = await createClient().auth.updateUser({ password });
    setSaving(false);
    if (error) return setError(t('failed'));
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <AuthShell>
      <div className={styles.heading}>
        <h1 className="pageTitle">{t('title')}</h1>
        <p className={styles.subtitle}>{signedIn === false ? t('expired') : t('subtitle')}</p>
      </div>
      {signedIn === false ? (
        <Link className={`button buttonPrimary ${styles.wide}`} href="/auth?mode=forgot">
          {t('requestNew')}
        </Link>
      ) : (
        <form className={styles.form} onSubmit={save} aria-label={t('title')}>
          <label className="label">
            {t('newPassword')}
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label className="label">
            {t('confirm')}
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
          {error ? (
            <div className="error" role="alert">
              {error}
            </div>
          ) : null}
          <button className={`button buttonPrimary ${styles.wide}`} type="submit" disabled={saving || signedIn === null}>
            {saving ? t('saving') : t('save')}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
