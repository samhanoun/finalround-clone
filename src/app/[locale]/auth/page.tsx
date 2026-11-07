'use client';

import { useId, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { safeNextPath } from '@/lib/safeRedirect';
import { stripLocalePrefix } from '@/i18n/locales';
import { domainFromEmail } from '@/lib/ssoDomain';
import { AuthShell } from './AuthShell';
import styles from './auth.module.css';

type Mode = 'login' | 'signup' | 'sso' | 'forgot';

const LINK_ERRORS = ['signin_failed', 'link_failed', 'missing_code'] as const;

/** Supabase's English error messages, as message keys. */
function errorKey(message: string): string | null {
  if (/invalid login credentials/i.test(message)) return 'invalidCredentials';
  if (/already registered|already exists/i.test(message)) return 'alreadyRegistered';
  if (/email not confirmed/i.test(message)) return 'notConfirmed';
  if (/provider is not enabled|unsupported provider/i.test(message)) return 'googleOff';
  if (/rate limit|too many/i.test(message)) return 'rateLimited';
  if (/password should be|weak password/i.test(message)) return 'weakPassword';
  return null;
}

function AuthForm() {
  const t = useTranslations('Auth');
  const passwordId = useId();
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  // Only paths on this site (see safeNextPath), never another site. Without its
  // language prefix: the router below and the auth callback add the current one.
  const nextParam = sp.get('next');
  const next = stripLocalePrefix(safeNextPath(nextParam));
  const initialMode = sp.get('mode');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>(
    initialMode === 'signup' || initialMode === 'sso' || initialMode === 'forgot' ? initialMode : 'login',
  );
  const linkError = sp.get('error');
  const [error, setError] = useState<string | null>(
    LINK_ERRORS.includes(linkError as (typeof LINK_ERRORS)[number]) ? t(`errors.${linkError}`) : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const callbackUrl = (to: string) =>
    `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(`/${locale}${to}`)}`;

  function show(e: unknown) {
    const message = e instanceof Error ? e.message : '';
    const key = errorKey(message);
    setError(key ? t(`errors.${key}`) : t('errors.generic'));
  }

  function switchTo(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }

  /** Team single sign-on (Supabase SAML): finds the identity provider by the email's domain. */
  async function startSso() {
    const domain = domainFromEmail(email);
    if (!domain) {
      setError(t('errors.workEmail'));
      return;
    }
    const { data, error } = await createClient().auth.signInWithSSO({ domain, options: { redirectTo: callbackUrl(next) } });
    if (error || !data?.url) {
      setError(t('errors.noSso', { domain }));
      return;
    }
    window.location.assign(data.url);
  }

  async function google() {
    setError(null);
    setLoading(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callbackUrl(mode === 'signup' && !nextParam ? '/onboarding' : next) },
    });
    // On success the browser is already on its way to Google.
    if (error) {
      show(error);
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === 'sso') {
        await startSso();
        return;
      }
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl('/auth/reset') });
        if (error) throw error;
        setNotice(t('resetSent', { email }));
        return;
      }
      if (mode === 'signup') {
        // A referral link (?ref=CODE) is credited after sign-up (see /api/referrals/claim).
        const ref = sp.get('ref')?.trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: callbackUrl(nextParam ? next : '/onboarding'),
            ...(ref ? { data: { referral_code: ref } } : {}),
          },
        });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation is on: the link in the email signs them in.
          setNotice(t('confirmSent', { email }));
          return;
        }
        // After signup: onboarding, unless a link brought them here (e.g. a team invitation).
        router.push(nextParam ? next : '/onboarding');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
      }
      router.refresh();
    } catch (e) {
      show(e);
    } finally {
      setLoading(false);
    }
  }

  const signup = mode === 'signup';
  const passwordMode = mode === 'login' || mode === 'signup';

  return (
    <AuthShell>
      <div className={styles.heading}>
        <h1 className="pageTitle">{t(`title.${mode}`)}</h1>
        <p className={styles.subtitle}>{t(`subtitle.${mode}`)}</p>
      </div>

      {passwordMode ? (
        <div className={styles.modes} role="group" aria-label={t('account')}>
          <button type="button" className={styles.mode} aria-pressed={!signup} onClick={() => switchTo('login')}>
            {t('haveAccount')}
          </button>
          <button type="button" className={styles.mode} aria-pressed={signup} onClick={() => switchTo('signup')}>
            {t('newHere')}
          </button>
        </div>
      ) : null}

      {passwordMode ? (
        <div className={styles.group}>
          <button type="button" className={`button ${styles.wide}`} onClick={() => void google()} disabled={loading}>
            <GoogleMark />
            {t('google')}
          </button>
          <p className={styles.or}>
            <span>{t('or')}</span>
          </p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className={styles.form} aria-label={t(`title.${mode}`)}>
        <label className="label">
          {mode === 'sso' ? t('workEmail') : t('email')}
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
          />
        </label>
        {passwordMode ? (
          <div className={styles.field}>
            <label className={`label ${styles.fieldLabel}`} htmlFor={passwordId}>
              {t('password')}
            </label>
            <input
              id={passwordId}
              className={`input ${styles.fieldInput}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              minLength={signup ? 8 : undefined}
              aria-describedby={signup ? `${passwordId}-help` : undefined}
              required
            />
            {signup ? (
              <span id={`${passwordId}-help`} className={`help ${styles.fieldHelp}`}>
                {t('passwordHelp')}
              </span>
            ) : null}
            {/* Shown beside the label, but after the field when tabbing. */}
            {mode === 'login' ? (
              <button type="button" className={styles.textButton} onClick={() => switchTo('forgot')}>
                {t('forgot')}
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="success" role="status">
            {notice}
          </div>
        ) : null}

        <button className={`button buttonPrimary ${styles.wide}`} disabled={loading} type="submit">
          {loading ? t(`working.${mode}`) : t(`submit.${mode}`)}
        </button>
      </form>

      {mode === 'login' || mode === 'signup' ? (
        <button type="button" className={`button buttonGhost ${styles.wide}`} onClick={() => switchTo('sso')}>
          {t('useSso')}
        </button>
      ) : (
        <button type="button" className={`button buttonGhost ${styles.wide}`} onClick={() => switchTo('login')}>
          {t('backToSignIn')}
        </button>
      )}
    </AuthShell>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export default function AuthPage() {
  return (
    // Until the address's ?mode= is read: the same page, without the form.
    <Suspense fallback={<AuthShell />}>
      <AuthForm />
    </Suspense>
  );
}
