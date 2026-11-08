import { timingSafeEqual } from 'node:crypto';

/**
 * Cron endpoints authenticate with `Authorization: Bearer <secret>`, never a
 * query parameter (URLs end up in proxy and access logs and Referer headers).
 * Comparison is constant-time, and a secret under 32 characters never matches.
 */
export function bearerToken(req: Request): string {
  return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
}

export function matchesSecret(given: string, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 32) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when the request carries one of the accepted cron secrets. */
export function isCronAuthorized(req: Request, secrets: Array<string | undefined>): boolean {
  const given = bearerToken(req);
  return secrets.some((secret) => matchesSecret(given, secret));
}
