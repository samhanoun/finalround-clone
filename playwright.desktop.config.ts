import { defineConfig } from '@playwright/test';
import { PORTS, fakeAppEnv } from './e2e/fakes/config.cjs';

/**
 * The desktop app (desktop/), launched through Playwright's Electron support
 * and showing the web app on the local fakes (e2e/fakes).
 *
 *   npm --prefix desktop run build
 *   npx playwright test -c playwright.desktop.config.ts
 *
 * No browser download: Playwright drives the desktop app's own Electron. As
 * with playwright.app.config.ts, E2E_BASE_URL uses an app that is already
 * running against the fakes; without it, the fakes and the app are started
 * here. Don't run it alongside the app suite on the same fakes: starting a
 * live session ends the fake user's other sessions.
 */

const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORTS.app}`;

export default defineConfig({
  testDir: './e2e/desktop',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-desktop' }]] : 'list',
  use: { baseURL: APP_URL },
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
