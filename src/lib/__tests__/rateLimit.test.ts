import { rateLimit } from '@/lib/rateLimit';

describe('rateLimit', () => {
  it('allows first request and blocks when limit exceeded', async () => {
    const key = `test:${Date.now()}`;
    const limit = 2;
    const windowMs = 60_000;

    expect((await rateLimit({ key, limit, windowMs })).ok).toBe(true);
    expect((await rateLimit({ key, limit, windowMs })).ok).toBe(true);
    expect((await rateLimit({ key, limit, windowMs })).ok).toBe(false);
  });
});
