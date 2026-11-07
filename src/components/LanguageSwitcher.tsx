'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { ChangeEvent, useTransition } from 'react';
import { LOCALES } from '@/i18n/locales';
import { SettingRow } from '@/app/[locale]/settings/SettingsUI';

/**
 * Settings → Language & region → App language. The page switches at once;
 * the choice is also saved to the account, so emails and notifications come
 * in the same language.
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
      router.replace(`${pathname}#language`, { locale: nextLocale });
    });
  };

  return (
    <SettingRow label={t('language')} help={t('languageDescription')} htmlFor="language-select">
      <select id="language-select" className="select" defaultValue={locale} onChange={onSelectChange} disabled={isPending} lang={locale}>
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {t(`languages.${code}`)}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}
