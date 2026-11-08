import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/i18n/locales';

/**
 * Signing in on another device: the app opens in the language saved to the
 * account (Settings → App language, user_settings.language) rather than the
 * one the browser was given. Used by the sign-in page (password) and the auth
 * callback (Google, single sign-on).
 */

/** The language a path names itself ("/es/goals" → "es"), or null. */
export function localeOfPath(path: string | null | undefined): Locale | null {
  const match = /^\/([a-z]{2})(?=$|[/?#])/.exec(path ?? '');
  return match && (LOCALES as readonly string[]).includes(match[1]) ? (match[1] as Locale) : null;
}

/**
 * The saved language to switch to after signing in, or null to stay. Stays
 * when `next` names a language itself (whoever made that link chose it), and
 * for English: the column defaults to it, so a saved "en" doesn't show that
 * anyone picked it.
 */
export function savedLocaleToRestore(saved: unknown, current: string, nextParam?: string | null): Locale | null {
  if (localeOfPath(nextParam)) return null;
  if (typeof saved !== 'string' || !(LOCALES as readonly string[]).includes(saved)) return null;
  if (saved === current || saved === DEFAULT_LOCALE) return null;
  return saved as Locale;
}

/** A site path such as `next` ("/es/dashboard") in another language ("/fr/dashboard"). */
export function withLocale(path: string, locale: Locale): string {
  const current = localeOfPath(path);
  // After "/es" comes nothing, "/…", "?…" or "#…"; a path without a language starts with "/".
  return `/${locale}${current ? path.slice(current.length + 1) : path}`;
}
