'use client';

import { Link } from '@/i18n/routing';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/browser';
import { ApexMark } from './ApexMark';
import {
  ChartIcon,
  CloseIcon,
  HelpIcon,
  HomeIcon,
  JobsIcon,
  LetterIcon,
  LiveIcon,
  MoreIcon,
  PracticeIcon,
  ResumeIcon,
  SettingsIcon,
  TargetIcon,
  UsersIcon,
  type IconProps,
} from './icons';
import { SignOutButton } from './SignOutButton';
import { NotificationBell } from './NotificationBell';
import styles from './AppShell.module.css';

type NavKey = 'home' | 'live' | 'goals' | 'practice' | 'resume' | 'coverLetters' | 'jobs' | 'analytics' | 'teams' | 'help' | 'settings';
type NavItem = { href: string; key: NavKey; Icon: ComponentType<IconProps>; also?: string[] };

const ITEMS: Record<NavKey, NavItem> = {
  home: { href: '/dashboard', key: 'home', Icon: HomeIcon },
  live: { href: '/copilot/live', key: 'live', Icon: LiveIcon },
  goals: { href: '/goals', key: 'goals', Icon: TargetIcon },
  practice: { href: '/interview', key: 'practice', Icon: PracticeIcon },
  resume: { href: '/resume', key: 'resume', Icon: ResumeIcon },
  coverLetters: { href: '/cover-letters', key: 'coverLetters', Icon: LetterIcon },
  jobs: { href: '/jobs', key: 'jobs', Icon: JobsIcon },
  analytics: { href: '/analytics', key: 'analytics', Icon: ChartIcon },
  teams: { href: '/teams', key: 'teams', Icon: UsersIcon },
  help: { href: '/support', key: 'help', Icon: HelpIcon },
  settings: { href: '/settings', key: 'settings', Icon: SettingsIcon },
};

/** The sidebar: what you do in an interview first, then preparation, then how it's going. */
const SIDEBAR: Array<{ section?: 'prepare' | 'progress'; items: NavKey[] }> = [
  { items: ['home', 'live'] },
  { section: 'prepare', items: ['goals', 'practice', 'resume', 'coverLetters', 'jobs'] },
  { section: 'progress', items: ['analytics'] },
];
const SIDEBAR_FOOT: NavKey[] = ['teams', 'help', 'settings'];

/** Phones and tablets: four tabs and More. */
const TABS: NavKey[] = ['home', 'live', 'practice', 'jobs'];
const MORE: NavKey[] = ['goals', 'resume', 'coverLetters', 'analytics', 'teams', 'help', 'settings'];

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

/**
 * The app frame. Desktop: a sidebar with every section. Phones and tablets:
 * a top bar and a bottom tab bar, with the rest of the sections under More.
 * `mobileNav={false}` hides the tab bar, for screens that need the whole
 * height (a live session).
 */
export function AppShell(props: { title?: string; actions?: React.ReactNode; children: React.ReactNode; mobileNav?: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations('AppShell');
  const tBrand = useTranslations('Brand');
  const showTabs = props.mobileNav !== false;

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

  const active = (key: NavKey) => isActive(pathname, ITEMS[key].href, ITEMS[key].also);
  const label = (key: NavKey) => t(`nav.${key}`);
  const initial = user?.email?.trim().charAt(0).toUpperCase() ?? '';

  const navLink = (key: NavKey, className: string) => {
    const { href, Icon } = ITEMS[key];
    return (
      <Link key={key} href={href} className={className} aria-current={active(key) ? 'page' : undefined}>
        <Icon size={18} className={styles.navIcon} />
        <span className={styles.navLabel}>{label(key)}</span>
      </Link>
    );
  };

  return (
    <div className={`${styles.shell} ${showTabs ? styles.withTabs : ''}`}>
      {/* Desktop sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.brandRow}>
          <Link href="/dashboard" className={styles.brandLink} aria-label={t('home')}>
            <ApexMark size={24} />
            <span className={styles.wordmark}>{tBrand('name')}</span>
          </Link>
          {user ? <NotificationBell placement="side" /> : null}
        </div>

        <nav aria-label={t('primaryNavigation')} className={styles.nav}>
          {SIDEBAR.map((group, index) => (
            <div key={group.section ?? index} className={styles.navGroup}>
              {group.section ? <div className={styles.sectionLabel}>{t(`sections.${group.section}`)}</div> : null}
              {group.items.map((key) => navLink(key, styles.navItem))}
            </div>
          ))}
          <div className={`${styles.navGroup} ${styles.navFoot}`}>{SIDEBAR_FOOT.map((key) => navLink(key, styles.navItem))}</div>
        </nav>

        <div className={styles.account}>
          {user ? (
            <>
              <span className={styles.avatar} aria-hidden="true">
                {initial}
              </span>
              <span className={styles.email} title={user.email ?? undefined}>
                <span className="srOnly">{t('signedInAs', { email: user.email ?? '' })}</span>
                <span aria-hidden="true">{user.email}</span>
              </span>
              <SignOutButton compact />
            </>
          ) : (
            <Link className="button buttonPrimary" href="/auth" style={{ width: '100%' }}>
              {t('signIn')}
            </Link>
          )}
        </div>
      </aside>

      {/* Phone and tablet top bar */}
      <header className={styles.topBar}>
        <Link href="/dashboard" className={styles.brandLink} aria-label={t('home')}>
          <ApexMark size={24} />
          <span className={styles.wordmark}>{tBrand('name')}</span>
        </Link>
        <div className={styles.topActions}>
          {user ? <NotificationBell /> : (
            <Link className="button buttonSmall" href="/auth">
              {t('signIn')}
            </Link>
          )}
        </div>
      </header>

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

      {showTabs ? (
        <nav aria-label={t('primaryNavigation')} className={styles.tabBar}>
          {TABS.map((key) => navLink(key, styles.tab))}
          <button
            type="button"
            className={styles.tab}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={MORE.some(active) ? 'page' : undefined}
            onClick={() => setMoreOpen(true)}
          >
            <MoreIcon size={18} className={styles.navIcon} />
            <span className={styles.navLabel}>{t('nav.more')}</span>
          </button>
        </nav>
      ) : null}

      {moreOpen ? (
        <MoreSheet
          title={t('nav.more')}
          closeLabel={t('close')}
          email={user?.email ?? null}
          onClose={() => setMoreOpen(false)}
        >
          {MORE.map((key) => navLink(key, styles.sheetItem))}
        </MoreSheet>
      ) : null}
    </div>
  );
}

/** The rest of the sections on phones: a bottom sheet (a modal dialog, so focus stays inside). */
function MoreSheet(props: { title: string; closeLabel: string; email: string | null; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { onClose } = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const close = () => onClose();
    dialog.addEventListener('close', close);
    return () => dialog.removeEventListener('close', close);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-label={props.title}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself) closes it; a link click navigates away.
        if (event.target === event.currentTarget || (event.target as HTMLElement).closest('a')) ref.current?.close();
      }}
    >
      <div className={styles.sheetHeader}>
        <span className={styles.sheetTitle}>{props.title}</span>
        <button type="button" className="iconButton" aria-label={props.closeLabel} onClick={() => ref.current?.close()}>
          <CloseIcon size={18} />
        </button>
      </div>
      <nav className={styles.sheetList}>{props.children}</nav>
      {props.email ? (
        <div className={styles.sheetAccount}>
          <span className={styles.email}>{props.email}</span>
          <SignOutButton />
        </div>
      ) : null}
    </dialog>
  );
}
