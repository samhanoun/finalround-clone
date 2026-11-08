'use client';

import { useId, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { LOCALES, type Locale } from '@/i18n/locales';
import { GlobeIcon } from '@/components/icons';
import styles from './auth.module.css';

/**
 * The page's language, before anyone is signed in: each language is listed in
 * its own name, so a visitor can find theirs whatever the page is in. The
 * address keeps its query (?next=, ?mode=), so signing in still returns to the
 * page that asked, in the chosen language.
 */
export function AuthLanguage() {
  const t = useTranslations('Auth');
  const tNames = useTranslations('settings.languages');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const id = useId();

  function change(next: Locale) {
    // The address's query (?next=, ?mode=) goes along to the other language.
    const query = window.location.search;
    startTransition(() => {
      router.replace(`${pathname}${query}`, { locale: next });
    });
  }

  return (
    <span className={styles.language}>
      <label className="srOnly" htmlFor={id}>
        {t('language')}
      </label>
      <GlobeIcon size={16} className={styles.languageIcon} />
      <select
        id={id}
        className={`select ${styles.languageSelect}`}
        value={locale}
        onChange={(event) => change(event.target.value as Locale)}
        disabled={pending}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {tNames(code)}
          </option>
        ))}
      </select>
    </span>
  );
}
