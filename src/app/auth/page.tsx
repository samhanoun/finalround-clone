'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/browser';

function AuthForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();

      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        
        // After signup, redirect to onboarding
        router.push('/onboarding');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        // Check if onboarding is completed before going to dashboard
        router.push(next);
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Auth failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container" style={{ padding: '44px 0 64px' }}>
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="cardInner stack" style={{ padding: 22 }}>
          <div className="stack" style={{ gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: '1.9rem' }}>Login</h1>
            <p className="help">Supabase email/password auth. (No secrets are stored client-side.)</p>
          </div>

          <div className="row" role="tablist" aria-label="Auth mode">
            <button className={`button ${mode === 'login' ? 'buttonPrimary' : ''}`} onClick={() => setMode('login')}>
              Login
            </button>
            <button className={`button ${mode === 'signup' ? 'buttonPrimary' : ''}`} onClick={() => setMode('signup')}>
              Sign up
            </button>
            <Link className="button" href="/">
              Back
            </Link>
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
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
              />
            </label>

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">Redirect: <span className="mono">{next}</span></span>
              <button className="button buttonPrimary" disabled={loading} type="submit">
                {loading ? '…' : mode === 'login' ? 'Login' : 'Create account'}
              </button>
            </div>
          </form>

          {error ? <div className="error">{error}</div> : null}

          <p className="small">
            Tip: if you hit an auth wall, ensure Supabase URL + anon key are set in <span className="mono">.env.local</span>.
          </p>
        </div>
      </div>
    </main>
  );
}

function AuthLoading() {
  return (
    <main className="container" style={{ padding: '44px 0 64px' }}>
      <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="cardInner stack" style={{ padding: 22 }}>
          <p>Loading...</p>
        </div>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <AuthForm />
    </Suspense>
  );
}
