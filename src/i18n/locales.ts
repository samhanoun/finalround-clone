// The supported locales, without next-intl, so server code (and Jest) can use them.
export const LOCALES = ['en', 'es', 'fr', 'de', 'pt'] as const;
export const DEFAULT_LOCALE = 'en';

export type Locale = (typeof LOCALES)[number];
