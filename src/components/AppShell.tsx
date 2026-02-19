'use client';

import Link from 'next/link';
import { createClient } from '@/lib/supabase/browser';
import { SignOutButton } from './SignOutButton';
import { NotificationBell } from './NotificationBell';

export async function AppShell(props: { title?: string; children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  return (
    <div>
      <header
        role="banner"
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
            <Link 
              href="/" 
              style={{ fontWeight: 750, letterSpacing: 0.2 }} 
              aria-label="FinalRound Home"
            >
              FinalRound
            </Link>
            <span className="badge" aria-hidden="true">
              MVP
            </span>
          </div>

          <nav 
            role="navigation" 
            aria-label="Primary navigation" 
            className="row" 
            style={{ gap: 12 }}
          >
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/jobs">Jobs</Link>
            <Link href="/copilot/live">Live Copilot</Link>
            <Link href="/resume">Resume</Link>
            <Link href="/settings">Settings</Link>
          </nav>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            {user ? (
              <>
                <NotificationBell />
                <span 
                  className="small" 
                  style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  aria-label={`Logged in as ${user.email}`}
                >
                  {user.email}
                </span>
                <SignOutButton />
              </>
            ) : (
              <Link 
                className="button buttonPrimary" 
                href="/auth"
                aria-label="Sign in to your account"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </header>

      <main 
        id="main-content" 
        className="container" 
        role="main"
        style={{ padding: '28px 0 64px' }}
        tabIndex={-1}
      >
        {props.title ? (
          <div className="stack" style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: '1.8rem', margin: 0 }}>{props.title}</h1>
          </div>
        ) : null}

        {props.children}
      </main>

      <footer 
        role="contentinfo" 
        className="container" 
        style={{ padding: '18px 0 28px', borderTop: '1px solid var(--border)' }}
      >
        <p className="small">
          Built with Next.js + Supabase. Keep it simple, keep it secure.
        </p>
      </footer>
    </div>
  );
}
