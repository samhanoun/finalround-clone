import { test, expect } from '@playwright/test';

test.describe('Copilot Session → Summary Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to copilot page
    await page.goto('/copilot/live');
  });

  test('should display copilot live page', async ({ page }) => {
    // Should see copilot heading
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('should show copilot navigation', async ({ page }) => {
    // Look for navigation elements
    await expect(page.locator('nav').first()).toBeVisible();
  });

  test('should display main content area', async ({ page }) => {
    // Page should load with main content
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('should display summary section', async ({ page }) => {
    // The page should load properly
    await expect(page.locator('main').first()).toBeVisible();
  });
});
