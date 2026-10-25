'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/browser';
import { ApexMark } from '@/components/ApexMark';
import styles from './auth.module.css';

function AuthForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>(sp.get('mode') === 'signup' ? 'signup' : 'login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();

      if (mode === 'signup') {
        // A referral link (?ref=CODE) is credited after sign-up (see /api/referrals/claim).
        const ref = sp.get('ref')?.trim();
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: ref ? { data: { referral_code: ref } } : undefined,
        });
        if (error) throw error;

        // After signup, redirect to onboarding
        router.push('/onboarding');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        router.push(next);
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed. Check your email and password.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const signup = mode === 'signup';

  return (
    <div className={styles.page}>
      <aside className={styles.brandPanel}>
        <Link href="/" className={styles.brandLink} aria-label="Apex Round home">
          <ApexMark size={40} />
          <span className={styles.brandName}>Apex Round</span>
        </Link>
        <div className={styles.brandCopy}>
          <p className={styles.brandLine}>Two voices. One answer on screen before you need it.</p>
          <div className={styles.signal} aria-hidden="true">
            <span className={styles.signalWho} data-voice="interviewer">Interviewer</span>
            <svg viewBox="0 0 320 36" className={styles.trace}>
              <path
                d="M0 18 h22 l3 -10 l4 20 l4 -26 l4 30 l4 -18 l4 10 l4 -6 h12 l3 -12 l4 22 l4 -14 l4 8 h24 l3 -6 l4 12 l4 -16 l4 20 l4 -10 h170"
                stroke="var(--ice)"
              />
            </svg>
            <span className={styles.signalWho} data-voice="you">You</span>
            <svg viewBox="0 0 320 36" className={styles.trace}>
              <path d="M0 18 h150 l3 -6 l4 12 l4 -9 l4 6 l4 -3 h151" stroke="var(--ember)" />
            </svg>
          </div>
        </div>
      </aside>

      <main id="main-content" className={styles.formSide} tabIndex={-1}>
        <div className={styles.formBox}>
          <div className={styles.heading}>
            <h1 className="pageTitle">{signup ? 'Create your account' : 'Sign in'}</h1>
            <p className="help">{signup ? 'Free to start, with 10 minutes of live help a month.' : 'Welcome back.'}</p>
          </div>

          <div className={styles.modes} role="group" aria-label="Account">
            <button
              type="button"
              className={styles.mode}
              aria-pressed={!signup}
              onClick={() => setMode('login')}
            >
              I have an account
            </button>
            <button type="button" className={styles.mode} aria-pressed={signup} onClick={() => setMode('signup')}>
              I&apos;m new here
            </button>
          </div>

          <form onSubmit={onSubmit} className="stack" aria-label="Auth form">
            <label className="label">
              Email
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <label className="label">
              Password
              <input
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={signup ? 8 : undefined}
                required
              />
            </label>

            {error ? (
              <div className="error" role="alert">
                {error}
              </div>
            ) : null}

            <button className={`button buttonPrimary ${styles.submit}`} disabled={loading} type="submit">
              {loading ? (signup ? 'Creating your account…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="small">
            <Link href="/">Back to the home page</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className={styles.page}>
      <main className={styles.formSide}>
        <p className="small">Loading…</p>
      </main>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <AuthForm />
    </Suspense>
  );
}
