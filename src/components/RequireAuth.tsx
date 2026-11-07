'use client';

import { Link, usePathname } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/browser';
import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { useTranslations } from 'next-intl';
import styles from '@/components/Skeleton/Skeleton.module.css';

/** How long the session check may take before "Loading…" shows (most finish well before). */
const QUIET_MS = 600;

/**
 * Shows its children to a signed-in user. Signed out: a calm centred message
 * with Sign in (which comes back here afterwards).
 */
export function RequireAuth(props: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const pathname = usePathname();
  const t = useTranslations('RequireAuth');

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => setSlow(true), QUIET_MS);
    async function checkAuth() {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setUser(data.user);
      setLoading(false);
    }
    void checkAuth();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (loading) {
    return (
      <div className={styles.guardPending} role="status" aria-live="polite">
        <span className="srOnly">{t('loading')}</span>
        {slow ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            <span className={styles.spinnerText} aria-hidden="true">
              {t('loading')}
            </span>
          </>
        ) : null}
      </div>
    );
  }

  if (!user) {
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    return (
      <div className={styles.guard}>
        <h2 className={styles.guardTitle}>{t('title')}</h2>
        <p className={styles.guardText}>{t('description')}</p>
        <div className={styles.guardActions}>
          <Link className="button buttonPrimary" href={`/auth${next}`}>
            {t('signIn')}
          </Link>
          <Link className="button buttonGhost" href="/">
            {t('home')}
          </Link>
        </div>
      </div>
    );
  }

  return <>{props.children}</>;
}
