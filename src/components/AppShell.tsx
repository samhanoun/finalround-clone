'use client';

import { Link } from '@/i18n/routing';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';
import { ApexMark } from './ApexMark';
import { HelpIcon, HomeIcon, JobsIcon, LiveIcon, PracticeIcon, ResumeIcon, SettingsIcon, TargetIcon } from './icons';
import { SignOutButton } from './SignOutButton';
import { NotificationBell } from './NotificationBell';
import styles from './AppShell.module.css';

const NAV: Array<{ href: string; label: 'home' | 'live' | 'goals' | 'practice' | 'resume' | 'jobs' | 'settings'; Icon: ComponentType<{ size?: number }>; also?: string[] }> = [
  { href: '/dashboard', label: 'home', Icon: HomeIcon },
  { href: '/copilot/live', label: 'live', Icon: LiveIcon },
  { href: '/goals', label: 'goals', Icon: TargetIcon },
  { href: '/interview', label: 'practice', Icon: PracticeIcon },
  { href: '/resume', label: 'resume', Icon: ResumeIcon, also: ['/cover-letters'] },
  { href: '/jobs', label: 'jobs', Icon: JobsIcon },
  { href: '/settings', label: 'settings', Icon: SettingsIcon },
];

/** Credits the referral link this account signed up with; the server ignores repeats. */
function claimReferralOnce(userId: string) {
  const key = `apex:referral-claimed:${userId}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    // No storage (private mode): the server still only counts the first claim.
  }
  void fetch('/api/referrals/claim', { method: 'POST' }).catch(() => undefined);
}

/** `/en/copilot/live` and `/copilot/live` both match the Live item; `also` lists sub-pages kept elsewhere. */
function isActive(pathname: string | null, href: string, also: string[] = []): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
  return [href, ...also].some((base) => path === base || path.startsWith(`${base}/`));
}

export function AppShell(props: { title?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const pathname = usePathname();
  const t = useTranslations('AppShell');

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user?.user_metadata?.referral_code) claimReferralOnce(data.user.id);
    });
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
        <Link href="/dashboard" className={styles.brandLink} aria-label={t('home')}>
          <ApexMark size={38} />
        </Link>

        <nav aria-label={t('primaryNavigation')} className={styles.nav}>
          {NAV.map(({ href, label, Icon, also }) => (
            <Link
              key={href}
              href={href}
              className={styles.navItem}
              aria-current={isActive(pathname, href, also) ? 'page' : undefined}
            >
              <Icon size={22} />
              <span>{t(`nav.${label}`)}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.account}>
          {user ? (
            <>
              <Link
                href="/support"
                className="button buttonGhost"
                style={{ padding: 0, width: 44 }}
                aria-label={t('help')}
                title={t('help')}
                aria-current={isActive(pathname, '/support') ? 'page' : undefined}
              >
                <HelpIcon size={20} />
              </Link>
              <NotificationBell placement="side" />
              <span className={styles.avatar} title={user.email ?? undefined} aria-label={t('signedInAs', { email: user.email ?? '' })}>
                {initial}
              </span>
              <SignOutButton compact />
            </>
          ) : (
            <Link className="button buttonPrimary" href="/auth">
              {t('signIn')}
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
