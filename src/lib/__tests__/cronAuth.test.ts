/** @jest-environment node */
import { isCronAuthorized, matchesSecret } from '@/lib/cronAuth';

const SECRET = 'x'.repeat(40);
const request = (authorization?: string) => new Request('http://localhost/api/cron/x', { headers: authorization ? { authorization } : {} });

describe('cron authorization', () => {
  it('accepts the secret only as a bearer token', () => {
    expect(isCronAuthorized(request(`Bearer ${SECRET}`), [SECRET])).toBe(true);
    expect(isCronAuthorized(request(`bearer ${SECRET}`), [SECRET])).toBe(true);
    expect(isCronAuthorized(request(), [SECRET])).toBe(false);
    expect(isCronAuthorized(request('Bearer wrong'), [SECRET])).toBe(false);
  });

  it('checks every accepted secret and ignores unset ones', () => {
    const other = 'y'.repeat(40);
    expect(isCronAuthorized(request(`Bearer ${other}`), [undefined, SECRET, other])).toBe(true);
    expect(isCronAuthorized(request('Bearer '), [undefined])).toBe(false);
  });

  it('never matches a short or empty secret', () => {
    expect(matchesSecret('short', 'short')).toBe(false);
    expect(matchesSecret('', '')).toBe(false);
    expect(matchesSecret(SECRET, SECRET)).toBe(true);
  });
});
