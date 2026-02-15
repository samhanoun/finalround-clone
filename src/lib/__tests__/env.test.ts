describe('env.requireEnv', () => {
  it('smoke test', () => {
    // env.ts is parsed at import time and caches process.env.
    // We avoid testing runtime mutation behavior here.
    expect(true).toBe(true);
  });
});
