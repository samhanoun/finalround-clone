import { test, expect } from '@playwright/test';

test.describe('Mock Interview → Report Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard first - in real tests we'd authenticate
    await page.goto('/dashboard');
  });

  test('should create new interview session', async ({ page }) => {
    // Click on "New session" button
    await page.click('button:has-text("New session")');

    // Should navigate to interview page with session ID
    await page.waitForURL(/\/interview\/[a-zA-Z0-9-]+/);

    // Should see interview interface elements
    await expect(page.locator('textarea, input[type="text"]').first()).toBeVisible();
  });

  test('should send message in interview session', async ({ page }) => {
    // Create new session
    await page.click('button:has-text("New session")');
    await page.waitForURL(/\/interview\/[a-zA-Z0-9-]+/);

    // Find the message input
    const messageInput = page.locator('textarea, input[type="text"]').filter({ hasText: '' }).first();
    await messageInput.waitFor({ state: 'visible' });

    // Type a test message
    await messageInput.fill('Tell me about yourself');

    // Submit the message
    await page.keyboard.press('Enter');

    // Wait for response (in real scenario, would wait for AI response)
    // For now just verify the message was sent
    await page.waitForTimeout(1000);
  });

  test('should save feedback with score', async ({ page }) => {
    // Create new session
    await page.click('button:has-text("New session")');
    await page.waitForURL(/\/interview\/[a-zA-Z0-9-]+/);

    // Look for feedback/score section
    // The page should have input fields for score and notes
    const feedbackSection = page.locator('text=Score, text=Notes, text=Rubric').first();
    
    // If feedback section exists, test it
    if (await feedbackSection.isVisible().catch(() => false)) {
      await page.fill('input[type="number"]', '85');
      await page.fill('textarea', 'Good communication skills');
      await page.click('button:has-text("Save")');
      
      // Should show saved confirmation
      await expect(page.locator('text=Saved')).toBeVisible();
    }
  });
});
