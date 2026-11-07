'use client';

import { useEffect, useState } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { ApexMark } from '@/components/ApexMark';
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
    if (password !== confirm) return setError(t('mismatch'));
    setSaving(true);
    const { error } = await createClient().auth.updateUser({ password });
    setSaving(false);
    if (error) return setError(t('failed'));
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div className={styles.page} style={{ gridTemplateColumns: '1fr' }}>
      <main id="main-content" className={styles.formSide} tabIndex={-1}>
        <div className={styles.formBox}>
          <ApexMark size={36} />
          <div className={styles.heading}>
            <h1 className="pageTitle">{t('title')}</h1>
            <p className="help">{signedIn === false ? t('expired') : t('subtitle')}</p>
          </div>
          {signedIn === false ? (
            <Link className={`button buttonPrimary ${styles.submit}`} href="/auth?mode=forgot">
              {t('requestNew')}
            </Link>
          ) : (
            <form className="stack" onSubmit={save}>
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
              <button className={`button buttonPrimary ${styles.submit}`} type="submit" disabled={saving || signedIn === null}>
                {saving ? t('saving') : t('save')}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
