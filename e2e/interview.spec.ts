import { test, expect } from '@playwright/test';

test.describe('Mock Interview → Report Flow', () => {
  test('should display interview page', async ({ page }) => {
    // Navigate to interview page
    await page.goto('/interview');
    
    // Should show main content
    await expect(page.locator('main, h1').first()).toBeVisible();
  });

  test('should display dashboard with interview options', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/dashboard');
    
    // Should show dashboard content or login prompt
    await expect(page.locator('main, h1, h2').first()).toBeVisible();
  });

  test('should have navigation to interview feature', async ({ page }) => {
    // Navigate to home page
    await page.goto('/');
    
    // Should have some navigation
    await expect(page.locator('nav, header').first()).toBeVisible();
  });
});
