'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { ChangeEvent, useTransition } from 'react';

export function LanguageSwitcher() {
  const t = useTranslations('settings');
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const onSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = event.target.value;
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  };

  const languages = [
    { code: 'en', name: t('languages.en') },
    { code: 'es', name: t('languages.es') },
    { code: 'fr', name: t('languages.fr') },
    { code: 'de', name: t('languages.de') },
    { code: 'pt', name: t('languages.pt') },
  ];

  return (
    <div className="languageSwitcher">
      <label htmlFor="language-select" className="languageLabel">
        {t('language')}
      </label>
      <select
        id="language-select"
        className="languageSelect"
        defaultValue={locale}
        onChange={onSelectChange}
        disabled={isPending}
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.name}
          </option>
        ))}
      </select>
      <style jsx>{`
        .languageSwitcher {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .languageLabel {
          font-weight: 600;
          color: var(--foreground);
        }
        .languageSelect {
          padding: 0.5rem;
          border-radius: 0.375rem;
          border: 1px solid var(--border);
          background: var(--background);
          color: var(--foreground);
          font-size: 0.875rem;
          cursor: pointer;
        }
        .languageSelect:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 2px var(--primary-alpha);
        }
        .languageSelect:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
