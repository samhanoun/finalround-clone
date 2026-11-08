import { defineConfig, devices } from '@playwright/test';
import { PORTS, fakeAppEnv } from './e2e/fakes/config.cjs';

/**
 * The whole app, end to end, against the local fakes (e2e/fakes): every
 * screen and every feature flow, signed in as the fake user.
 *
 *   npx playwright test -c playwright.app.config.ts
 *
 * Without E2E_BASE_URL it starts the fakes and the app itself. With
 * E2E_BASE_URL (for example http://localhost:3100) it uses an app that is
 * already running against the fakes, such as one started by a local script.
 *
 * The specs share one fake database, so each one creates its own uniquely
 * named data and never deletes data it didn't create.
 */

const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORTS.app}`;

export default defineConfig({
  testDir: './e2e/app',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      // Locally you can point at an installed Chromium instead of downloading Playwright's.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'node e2e/fakes/serve.mjs',
          url: `http://127.0.0.1:${PORTS.supabase}/__health`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: 'npm run dev',
          url: `${APP_URL}/en/auth`,
          reuseExistingServer: false,
          timeout: 300_000,
          env: fakeAppEnv(),
        },
      ],
});
