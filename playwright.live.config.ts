import { defineConfig, devices } from '@playwright/test';
import { PORTS, WAV_PATH, fakeAppEnv } from './e2e/fakes/config.cjs';

/**
 * The live copilot loop, end to end: fake interviewer audio → capture → STT
 * relay → transcript → question gate → streamed answer on screen.
 *
 *   npx playwright test -c playwright.live.config.ts
 *
 * By default Supabase, Deepgram and OpenAI are local fakes (e2e/fakes), so it
 * runs anywhere with no secrets. With E2E_REAL=1 it uses the real services
 * from the environment instead (see e2e/README.md).
 */

const REAL = process.env.E2E_REAL === '1';
const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORTS.app}`;
const questionWav = REAL ? process.env.E2E_QUESTION_WAV : WAV_PATH;

if (REAL && !questionWav) {
  throw new Error('E2E_REAL=1 needs E2E_QUESTION_WAV: a 16-bit PCM WAV of someone asking an interview question.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /copilot-live\.spec\.ts$/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Real runs type a real password and carry real session tokens: never record
  // traces, screenshots or HTML reports for them (they'd end up in CI artifacts).
  reporter: process.env.CI && !REAL ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_URL,
    trace: REAL ? 'off' : 'retain-on-failure',
    screenshot: REAL ? 'off' : 'only-on-failure',
    // The fake camera stands in for the shared screen (Solve screen).
    permissions: ['microphone', 'camera'],
    launchOptions: {
      // Locally you can point at an installed Chromium instead of downloading Playwright's.
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${questionWav}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        ...(REAL
          ? []
          : [
              {
                command: 'node e2e/fakes/serve.mjs',
                url: `http://127.0.0.1:${PORTS.supabase}/__health`,
                reuseExistingServer: false,
                timeout: 30_000,
              },
            ]),
        {
          // The custom server (Next.js + STT relay), built into .next-e2e so it can run beside `npm run dev`.
          command: 'npm run dev',
          url: `${APP_URL}/en/auth`,
          reuseExistingServer: false,
          timeout: 300_000,
          env: REAL
            ? { PORT: String(PORTS.app), NEXT_DIST_DIR: '.next-e2e', NEXT_PUBLIC_E2E_FAKE_AUDIO: '1' }
            : fakeAppEnv(),
        },
      ],
});
