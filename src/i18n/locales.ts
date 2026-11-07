// The supported locales, without next-intl, so server code (and Jest) can use them.
export const LOCALES = ['en', 'es', 'fr', 'de', 'pt'] as const;
export const DEFAULT_LOCALE = 'en';

export type Locale = (typeof LOCALES)[number];

/**
 * "/es/copilot/live?x=1" → "/copilot/live?x=1". The locale-aware router adds the
 * current language itself, so a path that already has one would get it twice.
 */
export function stripLocalePrefix(path: string): string {
  const match = /^\/([a-z]{2})(?=$|[/?#])/.exec(path);
  if (!match || !(LOCALES as readonly string[]).includes(match[1])) return path;
  const rest = path.slice(match[0].length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}
