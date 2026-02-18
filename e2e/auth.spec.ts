import { test, expect } from '@playwright/test';

test.describe('Signup → Onboarding Flow', () => {
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'TestPassword123!';

  test('should complete signup and redirect to dashboard', async ({ page }) => {
    // Navigate to auth page
    await page.goto('/auth');
    await expect(page).toHaveTitle(/FinalRound/i);

    // Click on Sign up tab
    await page.click('button:has-text("Sign up")');

    // Fill in signup form
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);

    // Submit the form
    await page.click('button[type="submit"]');

    // Should redirect to dashboard after signup
    await page.waitForURL('/dashboard');
    await expect(page.locator('h2, h1')).toContainText(/Dashboard|Interview/i);
  });

  test('should show login form and allow login', async ({ page }) => {
    // Navigate to auth page
    await page.goto('/auth');

    // Login tab should be active by default
    await expect(page.locator('button:has-text("Login")')).toBeVisible();

    // Fill in login form (using the test user created above)
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', testPassword);

    // Submit the form
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await page.waitForURL('/dashboard');
  });

  test('should navigate from landing to signup', async ({ page }) => {
    // Navigate to landing page
    await page.goto('/');

    // Click Get Started button
    await page.click('a:has-text("Get Started")');

    // Should be on auth page
    await expect(page).toHaveURL(/\/auth/);
  });
});
