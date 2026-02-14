import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from './SignOutButton';

export async function AppShell(props: { title?: string; children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  return (
    <div>
      <a className="skipLink" href="#main">
        Skip to content
      </a>

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backdropFilter: 'blur(10px)',
          background: 'rgba(11, 15, 25, 0.55)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          className="container"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}
        >
          <div className="row" style={{ gap: 12 }}>
            <Link href="/" style={{ fontWeight: 750, letterSpacing: 0.2 }} aria-label="Home">
              FinalRound
            </Link>
            <span className="badge" aria-hidden>
              MVP
            </span>
          </div>

          <nav aria-label="Primary" className="row" style={{ gap: 12 }}>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/resume">Resume</Link>
            <Link href="/settings">Settings</Link>
          </nav>

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            {user ? (
              <>
                <span className="small" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.email}
                </span>
                <SignOutButton />
              </>
            ) : (
              <Link className="button buttonPrimary" href="/auth">
                Login
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="container" style={{ padding: '28px 0 64px' }}>
        {props.title ? (
          <div className="stack" style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: '1.8rem', margin: 0 }}>{props.title}</h1>
          </div>
        ) : null}

        {props.children}
      </main>

      <footer className="container" style={{ padding: '18px 0 28px', borderTop: '1px solid var(--border)' }}>
        <p className="small">Built with Next.js + Supabase. Keep it simple, keep it secure.</p>
      </footer>
    </div>
  );
}
