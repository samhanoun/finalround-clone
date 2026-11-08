/**
 * A `?next=` target that stays on this site: a path such as "/teams/join?token=…".
 * Anything else (another site, "//host", "/\host", a javascript: URL) gives the fallback.
 */
export function safeNextPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  try {
    const url = new URL(value, 'http://apex.invalid');
    return url.origin === 'http://apex.invalid' ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
