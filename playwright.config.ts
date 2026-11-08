import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The live loop, the whole-app suite (e2e/app) and the desktop app (e2e/desktop) need fake
  // services; they have their own configs (playwright.live.config.ts, playwright.app.config.ts,
  // playwright.desktop.config.ts).
  testIgnore: [/copilot-live\.spec\.ts$/, /[\\/]app[\\/]/, /[\\/]desktop[\\/]/, /[\\/]\.artifacts[\\/]/],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
