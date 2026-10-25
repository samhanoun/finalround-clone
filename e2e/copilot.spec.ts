import { test, expect } from '@playwright/test';

/**
 * Signed-out checks for the live copilot page. The full loop (audio →
 * transcript → question → streamed answer) is e2e/copilot-live.spec.ts, run
 * with `npx playwright test -c playwright.live.config.ts`.
 */
test.describe('Live copilot page, signed out', () => {
  test('asks the visitor to log in instead of showing the copilot', async ({ page }) => {
    await page.goto('/en/copilot/live');
    await expect(page.getByRole('heading', { name: "You're not logged in" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to login' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Session setup' })).toHaveCount(0);
  });

  test('keeps the copilot APIs closed', async ({ request }) => {
    const session = '7f1c2a9e-3b4d-4c5e-8f60-1a2b3c4d5e6f';
    for (const path of ['answer', 'gate', 'latency', 'transcript']) {
      const res = await request.post(`/api/copilot/sessions/${session}/${path}`, {
        data: { question: 'Why?', text: 'Why?', chunks: [{ text: 'hi' }], turns: [{}] },
      });
      expect([400, 401], `${path} → ${res.status()}`).toContain(res.status());
    }
    expect((await request.post('/api/copilot/sessions/start', { data: {} })).status()).toBe(401);
  });
});
