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

  test('should switch between login and signup', async ({ page }) => {
    await page.goto('/en/auth');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // "I’m new here" turns the form into sign-up, "I have an account" back into sign-in.
    await page.getByRole('button', { name: 'I’m new here' }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();

    await page.getByRole('button', { name: 'I have an account' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
