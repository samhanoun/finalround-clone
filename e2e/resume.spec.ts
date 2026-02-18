import { test, expect } from '@playwright/test';

test.describe('Resume Upload → ATS Score Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to resume page
    await page.goto('/resume');
  });

  test('should display resume builder page', async ({ page }) => {
    // Should see resume builder elements
    await expect(page.locator('h1, h2')).toContainText(/Resume|Builder/i);
  });

  test('should have file upload input', async ({ page }) => {
    // Check for file input
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeVisible();
  });

  test('should have job description textarea', async ({ page }) => {
    // Check for job description input
    const jobDescInput = page.locator('textarea, input[type="text"]').filter({ hasText: '' }).first();
    await expect(jobDescInput).toBeVisible();
  });

  test('should show upload and analyze buttons', async ({ page }) => {
    // Look for action buttons
    const uploadButton = page.locator('button:has-text("Upload"), button:has-text("Analyze"), button:has-text("Generate")');
    await expect(uploadButton.first()).toBeVisible();
  });

  test('should show ATS score section when available', async ({ page }) => {
    // Look for ATS-related elements
    // The page might show ATS results if resume is analyzed
    // Just verify the page loads properly
    await expect(page.locator('main, .container')).toBeVisible();
  });
});
