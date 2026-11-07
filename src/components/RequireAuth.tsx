'use client';

import { Link } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/browser';
import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { useTranslations } from 'next-intl';

export function RequireAuth(props: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const t = useTranslations('RequireAuth');

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      setUser(data.user);
      setLoading(false);
    }
    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p className="small">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">{t('title')}</h2>
          <p className="cardDesc">{t('description')}</p>
          <div className="row">
            <Link className="button buttonPrimary" href="/auth">
              {t('signIn')}
            </Link>
            <Link className="button" href="/">
              {t('home')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{props.children}</>;
}
