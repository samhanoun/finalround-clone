import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PORTS, USER } from '../fakes/config.cjs';
import { pickLocale, translate } from '../../desktop/src/i18n';
import { deleteCopilotSessions, field, fill, msg, type Locale } from '../app/helpers/flowsA';

/**
 * The desktop app (desktop/), launched for real through Playwright's Electron
 * support, showing the web app on the local fakes: the bridge the page gets,
 * the window frame, Settings → Desktop app (every control, saved by the
 * desktop app), the floating answer window, the navigation lock, and the page
 * shown when the server doesn't answer.
 *
 *   npm --prefix desktop run build
 *   npx playwright test -c playwright.desktop.config.ts
 *
 * The app starts in the OS language (English on CI), so the labels are read in
 * that language. Starting a session ends the fake user's other open sessions,
 * so this never runs at the same time as the app suite against the same fakes.
 */

const ROOT = path.resolve(__dirname, '../..');
const DESKTOP = path.join(ROOT, 'desktop');
const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORTS.app}`;
const ELECTRON = createRequire(path.join(DESKTOP, 'package.json'))('electron') as unknown as string;
const VERSION = (JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')) as { version: string }).version;
const FIRST_LOAD = { timeout: 90_000 };
const MAC = process.platform === 'darwin';

type Launched = { app: ElectronApplication; userData: string };

/** Starts the desktop app with its own profile (settings, sign-in, single-instance lock). */
async function launch(appUrl: string): Promise<Launched> {
  expect(fs.existsSync(path.join(DESKTOP, 'dist', 'main.js')), 'build the desktop app first: npm --prefix desktop run build').toBe(true);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-desktop-e2e-'));
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [DESKTOP],
    env: { ...process.env, APEX_APP_URL: appUrl, APEX_USER_DATA_DIR: userData },
    timeout: 60_000,
  });
  return { app, userData };
}

async function quit({ app, userData }: Launched): Promise<void> {
  // app.close() can wait on the renderer; a quit that hangs mustn't fail the run.
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 15_000))]);
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** The language a fresh profile starts in: the first of the OS languages the app has. */
async function startLocale(app: ElectronApplication): Promise<Locale> {
  const preferred = await app.evaluate(({ app: electronApp }) => electronApp.getPreferredSystemLanguages() as string[]);
  return pickLocale(preferred);
}

type Bounds = { x: number; y: number; width: number; height: number };
type WindowInfo = { id: number; url: string; visible: boolean; onTop: boolean; minimizable: boolean; bounds: Bounds };
/** What this file reads of Electron's BrowserWindow (Electron's types live in desktop/, not here). */
type ElectronWindow = {
  id: number;
  webContents: { getURL(): string };
  isVisible(): boolean;
  isAlwaysOnTop(): boolean;
  isMinimizable(): boolean;
  getBounds(): Bounds;
};

/** The desktop app's windows, as the main process sees them. */
function windows(app: ElectronApplication): Promise<WindowInfo[]> {
  return app.evaluate(({ BrowserWindow }) =>
    (BrowserWindow.getAllWindows() as ElectronWindow[]).map((win) => ({
      id: win.id,
      url: win.webContents.getURL(),
      visible: win.isVisible(),
      onTop: win.isAlwaysOnTop(),
      minimizable: win.isMinimizable(),
      bounds: win.getBounds(),
    })),
  );
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A local port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

type Command = 'answer-now' | 'solve-screen' | 'toggle-answers';

test.describe.serial('desktop app', () => {
  let launched: Launched;
  let page: Page;
  let locale: Locale = 'en';
  const sessions: string[] = [];

  const t = (key: string) => msg(key, locale);
  const command = (name: Command) => t(`Desktop.commands.${name}`);
  /** A shortcut as Settings reads it out, e.g. "Ctrl+Shift+A" (or "Ctrl+Maj+A" in French). */
  const spoken = (modifiers: Array<'mod' | 'alt' | 'shift'>, key: string) =>
    [
      ...modifiers.map((modifier) =>
        modifier === 'mod' ? t(MAC ? 'Desktop.keys.cmd' : 'Desktop.keys.ctrl') : modifier === 'alt' ? t(MAC ? 'Desktop.keys.option' : 'Desktop.keys.alt') : t(MAC ? 'Desktop.keys.shiftMac' : 'Desktop.keys.shift'),
      ),
      key,
    ].join('+');
  const changeLabel = (name: Command, keys: string) => fill(t('Desktop.changeLabel'), { command: command(name), keys });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(420_000);
    // A fresh dev server compiles each page on its first visit (20-60 s on CI): do it before the window opens.
    for (const route of ['/en/auth', '/en/copilot/live', '/en/settings', '/en/dashboard']) {
      await request.get(`${APP_URL}${route}`, { timeout: 120_000, maxRedirects: 0 }).catch(() => undefined);
    }
    launched = await launch(APP_URL);
    page = await launched.app.firstWindow();
    locale = await startLocale(launched.app);
  });

  test.afterAll(async ({ request }) => {
    if (launched) await quit(launched);
    await deleteCopilotSessions(request, sessions);
  });

  test('opens the live page, asks to sign in, and the page gets the desktop bridge and frame', async () => {
    // Signed out, the live page (in the OS language) asks you to sign in, then comes back.
    await page.waitForURL(new RegExp(`/${locale}/copilot/live$`), FIRST_LOAD);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: t('RequireAuth.title') })).toBeVisible(FIRST_LOAD);
    await main.getByRole('link', { name: t('RequireAuth.signIn'), exact: true }).click();
    await page.waitForURL(new RegExp(`/${locale}/auth\\?next=`), FIRST_LOAD);
    const form = page.getByRole('form', { name: t('Auth.title.login') });
    await form.getByLabel(t('Auth.email')).fill(USER.email);
    await form.getByLabel(t('Auth.password'), { exact: true }).fill(USER.password);
    await form.getByRole('button', { name: t('Auth.submit.login') }).click();
    await page.waitForURL(new RegExp(`/${locale}/copilot/live$`), FIRST_LOAD);
    await expect(page.getByRole('region', { name: t('SessionSetup.label') })).toBeVisible(FIRST_LOAD);

    // The page gets only these functions from the preload: no Node, no ipcRenderer.
    const bridge = await page.evaluate(() => {
      const desktop = (window as unknown as { apexDesktop: Record<string, unknown> }).apexDesktop;
      return {
        isDesktop: desktop.isDesktop,
        platform: desktop.platform,
        version: desktop.version,
        functions: Object.keys(desktop)
          .filter((key) => typeof desktop[key] === 'function')
          .sort(),
        node: typeof (window as unknown as { require?: unknown }).require,
      };
    });
    expect(bridge).toEqual({
      isDesktop: true,
      platform: process.platform,
      version: VERSION,
      functions: ['getSettings', 'hideForCapture', 'listDisplays', 'pauseShortcuts', 'setSettings', 'showAfterCapture'],
      node: 'undefined',
    });

    // No OS title bar: the page draws a 36 px drag strip under the window buttons.
    await expect(page.locator('html')).toHaveAttribute('data-desktop', process.platform);
    const strip = await page.locator('.desktopTitlebar').boundingBox();
    expect(strip).toMatchObject({ y: 0, height: 36 });

    const [mainWindow] = await windows(launched.app);
    expect(mainWindow).toMatchObject({ visible: true, onTop: false });
    expect(mainWindow.bounds.width).toBeGreaterThanOrEqual(900);
  });

  test('Settings → Desktop app: the screen, meeting detection, the tray and the shortcuts are saved by the desktop app', async () => {
    await page.goto(`${APP_URL}/${locale}/settings#desktop`, FIRST_LOAD);
    const nav = page.getByRole('navigation', { name: t('settings.sections.label') });
    // Hidden in a browser (flows-account checks that), shown here.
    await expect(nav.getByRole('link', { name: t('settings.sections.desktop'), exact: true })).toBeVisible(FIRST_LOAD);
    const section = page.locator('#desktop');
    await expect(section).toBeVisible();
    const settingsFile = path.join(launched.userData, 'settings.json');
    const current = () => page.evaluate(() => (window as unknown as { apexDesktop: { getSettings(): Promise<Record<string, unknown>> } }).apexDesktop.getSettings());

    // The screen to capture: one choice per display the desktop app reports.
    const displays = await page.evaluate(() =>
      (window as unknown as { apexDesktop: { listDisplays(): Promise<Array<{ id: string; primary: boolean }>> } }).apexDesktop.listDisplays(),
    );
    expect(displays.length).toBeGreaterThan(0);
    const screenSelect = section.getByRole('combobox', { name: field(t('Desktop.capture')) });
    await expect(screenSelect.locator('option')).toHaveCount(displays.length);
    let chosen = await screenSelect.inputValue();
    const other = displays.find((display) => display.id !== chosen);
    if (other) {
      await screenSelect.selectOption(other.id);
      await expect(section.getByText(t('Desktop.saved'), { exact: true })).toBeVisible();
      await expect.poll(async () => (await current()).captureDisplayId).toBe(other.id);
      chosen = other.id;
    } else {
      // One display: it's the choice, and there's nothing to switch to.
      expect(chosen).toBe(displays[0].id);
    }

    // Meeting detection (Windows only) and the tray: each switch is saved, in the desktop app's own file.
    const switches = [
      ...(process.platform === 'win32' ? [{ label: t('Desktop.detect'), key: 'meetingDetection' }] : []),
      { label: t('Desktop.tray'), key: 'closeToTray' },
    ];
    for (const { label, key } of switches) {
      const control = section.getByRole('switch', { name: field(label) });
      const before = await control.isChecked();
      await control.click();
      await expect(control).toBeChecked({ checked: !before });
      await expect.poll(async () => (await current())[key], `${key} in the desktop app`).toBe(!before);
      await expect.poll(() => readJson(settingsFile)?.[key], `${key} in settings.json`).toBe(!before);
      await control.click();
      await expect(control).toBeChecked({ checked: before });
      await expect.poll(async () => (await current())[key]).toBe(before);
    }

    // A shortcut: record new keys, refuse ones another command has, reset.
    const fresh = 'CommandOrControl+Alt+Shift+F7';
    // On a machine where another app holds them (or with no desktop session), the app says so instead.
    const free = await launched.app.evaluate(({ globalShortcut }, accelerator) => {
      const ok = globalShortcut.register(accelerator, () => undefined);
      if (ok) globalShortcut.unregister(accelerator);
      return ok as boolean;
    }, fresh);
    const answerNow = section.getByRole('button', { name: changeLabel('answer-now', spoken(['mod', 'shift'], 'A')) });
    await answerNow.click();
    const recording = section.getByRole('button', { name: fill(t('Desktop.recordingLabel'), { command: command('answer-now') }) });
    await expect(recording).toBeFocused();
    await page.keyboard.press(MAC ? 'Meta+Alt+Shift+F7' : 'Control+Alt+Shift+F7');
    if (free) {
      const changed = section.getByRole('button', { name: changeLabel('answer-now', spoken(['mod', 'alt', 'shift'], 'F7')) });
      await expect(changed).toBeVisible();
      await expect.poll(async () => ((await current()).shortcuts as Record<string, string>)['answer-now']).toBe(fresh);
      await expect
        .poll(() => (readJson(settingsFile)?.shortcuts as Record<string, string> | undefined)?.['answer-now'])
        .toBe(fresh);

      // Keys that Solve screen already has are refused, and the shortcut stays.
      await changed.click();
      await page.keyboard.press(MAC ? 'Meta+Shift+S' : 'Control+Shift+S');
      await expect(section.getByRole('alert')).toHaveText(fill(t('Desktop.errors.duplicate'), { command: command('solve-screen') }));
      await expect(changed).toBeVisible();

      // Reset puts the default back.
      await section
        .getByRole('button', { name: fill(t('Desktop.resetLabel'), { command: command('answer-now'), keys: spoken(['mod', 'shift'], 'A') }) })
        .click();
      await expect(answerNow).toBeVisible();
      await expect.poll(async () => ((await current()).shortcuts as Record<string, string>)['answer-now']).toBe('CommandOrControl+Shift+A');
    } else {
      await expect(section.getByRole('alert')).toHaveText(t('Desktop.errors.taken'));
      await expect(answerNow).toBeVisible();
      console.log('[desktop] global shortcuts can’t be registered here: checked the "taken" message instead');
    }

    // A reload reads them back from the desktop app.
    await page.reload(FIRST_LOAD);
    await expect(section.getByRole('combobox', { name: field(t('Desktop.capture')) })).toHaveValue(chosen);
    await expect(section.getByRole('button', { name: changeLabel('answer-now', spoken(['mod', 'shift'], 'A')) })).toBeVisible();
  });

  test('Pop out opens the answer window on top; it comes back where it was', async () => {
    await page.goto(`${APP_URL}/${locale}/copilot/live`, FIRST_LOAD);
    const setup = page.getByRole('region', { name: t('SessionSetup.label') });
    await expect(setup).toBeVisible(FIRST_LOAD);
    await setup.getByRole('textbox', { name: field(t('SessionSetup.company')) }).fill(`Desktop check ${Date.now().toString(36)}`);
    await setup.getByRole('textbox', { name: field(t('SessionSetup.role')) }).fill('Staff Engineer');
    const started = page.waitForResponse((res) => res.url().endsWith('/api/copilot/sessions/start') && res.request().method() === 'POST');
    await setup.getByRole('button', { name: t('SessionSetup.start') }).click();
    const res = await started;
    expect(res.status(), 'start session').toBe(201);
    sessions.push(((await res.json()) as { session: { id: string } }).session.id);
    await expect(page.getByRole('button', { name: t('SessionBar.stop') })).toBeVisible();

    // Electron can't host Document Picture-in-Picture: the desktop app's stand-in opens a window it keeps on top.
    await page.getByRole('button', { name: t('AnswerPanel.popOut') }).click();
    await expect(page.getByText(t('AnswerPanel.inWindow'))).toBeVisible();
    await expect.poll(async () => (await windows(launched.app)).length).toBe(2);
    const answer = (await windows(launched.app)).find((win) => win.url === 'about:blank');
    expect(answer, 'the answer window').toMatchObject({ visible: true, onTop: true, minimizable: false });

    // Moved (left and down from its top-right corner, so it stays fully on screen and
    // isn't pulled back), then brought back at once: it's saved, and the next one opens there.
    const target = { x: answer!.bounds.x - 60, y: answer!.bounds.y + 40, width: answer!.bounds.width, height: answer!.bounds.height };
    // Where it really went (display scaling can round a pixel or two).
    const moved = await launched.app.evaluate(({ BrowserWindow }, { id, bounds }) => {
      const win = BrowserWindow.fromId(id);
      win.setBounds(bounds);
      win.emit('moved');
      return win.getBounds() as Bounds;
    }, { id: answer!.id, bounds: target });
    expect(Math.abs(moved.x - target.x) + Math.abs(moved.y - target.y)).toBeLessThanOrEqual(4);
    const near = (bounds: { x: number; y: number } | null | undefined) =>
      Boolean(bounds) && Math.abs(bounds!.x - moved.x) <= 2 && Math.abs(bounds!.y - moved.y) <= 2;
    await page.getByRole('button', { name: t('AnswerPanel.bringBack') }).click();
    await expect.poll(async () => (await windows(launched.app)).length).toBe(1);
    await expect
      .poll(() => near(readJson(path.join(launched.userData, 'window-state.json'))?.answerWindow as { x: number; y: number } | undefined), 'saved position')
      .toBe(true);

    await page.getByRole('button', { name: t('AnswerPanel.popOut') }).click();
    await expect
      .poll(async () => near((await windows(launched.app)).find((win) => win.url === 'about:blank')?.bounds), 'reopened where it was')
      .toBe(true);
    await page.getByRole('button', { name: t('AnswerPanel.bringBack') }).click();
    await expect.poll(async () => (await windows(launched.app)).length).toBe(1);

    await page.getByRole('button', { name: t('SessionBar.stop') }).click();
    await expect(setup).toBeVisible();
  });

  test('links to other sites open in the default browser; the window stays on the app', async () => {
    await launched.app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { opened: string[] }).opened = opened;
      shell.openExternal = async (url: string) => {
        opened.push(url);
      };
    });
    const before = page.url();
    await page.evaluate(() => {
      window.location.href = 'https://example.com/elsewhere';
    });
    await page.evaluate(() => window.open('https://example.org/popup', '_blank'));
    await expect.poll(() => launched.app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([
      'https://example.com/elsewhere',
      'https://example.org/popup',
    ]);
    expect(page.url()).toBe(before);
    expect(await windows(launched.app)).toHaveLength(1);
  });
});

test('with nothing answering at the app URL, it shows a page to retry from', async () => {
  const port = await closedPort();
  const launched = await launch(`http://127.0.0.1:${port}`);
  try {
    const page = await launched.app.firstWindow();
    const locale = await startLocale(launched.app);
    const panel = page.getByRole('alert');
    await expect(panel.getByRole('heading', { name: translate(locale, 'offlineTitle') })).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText(`127.0.0.1:${port}`);
    await expect(panel.getByRole('link', { name: translate(locale, 'retry') })).toHaveAttribute(
      'href',
      `http://127.0.0.1:${port}/${locale}/copilot/live`,
    );
  } finally {
    await quit(launched);
  }
});
