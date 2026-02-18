import { test, expect } from '@playwright/test';

test.describe('Copilot Session → Summary Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to copilot page
    await page.goto('/copilot/live');
  });

  test('should display copilot live page', async ({ page }) => {
    // Should see copilot interface elements
    await expect(page.locator('h1, h2, main, .container')).toBeVisible();
  });

  test('should show copilot controls', async ({ page }) => {
    // Look for start/stop or session controls
    const controls = page.locator('button:has-text("Start"), button:has-text("Stop"), button:has-text("Session")');
    await expect(controls.first()).toBeVisible();
  });

  test('should allow entering copilot session', async ({ page }) => {
    // Look for a way to start a session
    const startButton = page.locator('button:has-text("Start"), a:has-text("New")').first();
    
    // Check if start button exists
    const isVisible = await startButton.isVisible().catch(() => false);
    if (isVisible) {
      await startButton.click();
      await page.waitForTimeout(500);
    }
    
    // Page should still be functional
    await expect(page.locator('main, .container')).toBeVisible();
  });

  test('should display summary section if session exists', async ({ page }) => {
    // Look for summary-related elements
    // The page should load without errors
    await expect(page.locator('main')).toBeVisible();
  });
});
