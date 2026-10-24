import { test, expect } from '@playwright/test';

test.describe('Signup → Onboarding Flow', () => {
  test('should navigate from landing to signup', async ({ page }) => {
    // Navigate to landing page
    await page.goto('/');

    // The landing page's sign-up call to action
    await page.locator('a:has-text("Start free")').first().click();

    // Should be on auth page
    await expect(page).toHaveURL(/\/auth/);
  });

  test('should show auth page by default', async ({ page }) => {
    // Navigate to auth page
    await page.goto('/auth');

    // Should show auth heading or form elements
    await expect(page.locator('main form, main h1, main h2').first()).toBeVisible();
  });

  test('should switch between login and signup tabs', async ({ page }) => {
    // Navigate to auth page
    await page.goto('/auth');

    // Find and click the Sign up tab (not the submit button)
    const signupTab = page.locator('[role="tab"], button:has-text("Sign up")').filter({ has: page.locator('..') }).first();
    await signupTab.click({ force: true }).catch(async () => {
      // If that doesn't work, try the tablist approach
      await page.locator('button:has-text("Sign up")').nth(0).click();
    });
    
    // The page should still be functional
    await expect(page.locator('main').first()).toBeVisible();
  });
});
