'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { ChangeEvent, useTransition } from 'react';
import { LOCALES } from '@/i18n/locales';

/**
 * Settings → App language. The choice is also saved to the account, so
 * emails and notifications come in the same language.
 */
export function LanguageSwitcher() {
  const t = useTranslations('settings');
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const onSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = event.target.value;
    // Best effort: the page still switches if saving fails or nobody is signed in.
    void fetch('/api/settings/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: nextLocale }),
    }).catch(() => undefined);
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  };

  return (
    <div className="languageSwitcher">
      <label htmlFor="language-select" className="srOnly">
        {t('language')}
      </label>
      <select id="language-select" className="select" defaultValue={locale} onChange={onSelectChange} disabled={isPending}>
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {t(`languages.${code}`)}
          </option>
        ))}
      </select>
      <style jsx>{`
        .languageSwitcher {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
      `}</style>
    </div>
  );
}
