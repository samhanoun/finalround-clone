import { rateLimit } from '@/lib/rateLimit';

describe('rateLimit', () => {
  it('allows first request and blocks when limit exceeded', () => {
    const key = `test:${Date.now()}`;
    const limit = 2;
    const windowMs = 60_000;

    expect(rateLimit({ key, limit, windowMs }).ok).toBe(true);
    expect(rateLimit({ key, limit, windowMs }).ok).toBe(true);
    expect(rateLimit({ key, limit, windowMs }).ok).toBe(false);
  });
});
