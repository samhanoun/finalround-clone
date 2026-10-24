'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';
import { ApexMark } from './ApexMark';
import { HomeIcon, JobsIcon, LiveIcon, PracticeIcon, ResumeIcon, SettingsIcon } from './icons';
import { SignOutButton } from './SignOutButton';
import { NotificationBell } from './NotificationBell';
import styles from './AppShell.module.css';

const NAV: Array<{ href: string; label: string; Icon: ComponentType<{ size?: number }> }> = [
  { href: '/dashboard', label: 'Home', Icon: HomeIcon },
  { href: '/copilot/live', label: 'Live', Icon: LiveIcon },
  { href: '/interview', label: 'Practice', Icon: PracticeIcon },
  { href: '/resume', label: 'Résumé', Icon: ResumeIcon },
  { href: '/jobs', label: 'Jobs', Icon: JobsIcon },
  { href: '/settings', label: 'Settings', Icon: SettingsIcon },
];

/** `/en/copilot/live` and `/copilot/live` both match the Live item. */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
  return path === href || path.startsWith(`${href}/`);
}

export function AppShell(props: { title?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const initial = user?.email?.trim().charAt(0).toUpperCase() ?? '';

  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <Link href="/dashboard" className={styles.brandLink} aria-label="Apex Round home">
          <ApexMark size={38} />
        </Link>

        <nav aria-label="Primary navigation" className={styles.nav}>
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={styles.navItem}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
            >
              <Icon size={22} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.account}>
          {user ? (
            <>
              <NotificationBell placement="side" />
              <span className={styles.avatar} title={user.email ?? undefined} aria-label={`Signed in as ${user.email}`}>
                {initial}
              </span>
              <SignOutButton compact />
            </>
          ) : (
            <Link className="button buttonPrimary" href="/auth" aria-label="Sign in to your account">
              Sign in
            </Link>
          )}
        </div>
      </aside>

      <main id="main-content" className={styles.main} role="main" tabIndex={-1}>
        <div className={styles.content}>
          {props.title || props.actions ? (
            <header className={styles.pageHeader}>
              {props.title ? <h1 className="pageTitle">{props.title}</h1> : <span />}
              {props.actions ? <div className={styles.pageActions}>{props.actions}</div> : null}
            </header>
          ) : null}
          {props.children}
        </div>
      </main>
    </div>
  );
}
