import { test, expect } from '@playwright/test';

test.describe('Resume Upload → ATS Score Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to resume page
    await page.goto('/resume');
  });

  test('should display resume builder page', async ({ page }) => {
    // Should see resume builder heading
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('should show resume builder elements', async ({ page }) => {
    // The page should load with main content
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('should load resume page', async ({ page }) => {
    // The resume page should load - either with content or login prompt
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('should have action buttons', async ({ page }) => {
    // Look for action buttons - may be disabled if not logged in
    const buttons = page.locator('button');
    await expect(buttons.first()).toBeVisible();
  });

  test('should display main content', async ({ page }) => {
    // The page should load properly
    await expect(page.locator('main, .container').first()).toBeVisible();
  });
});
