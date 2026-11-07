import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  screen,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type NativeImage,
  type Session,
  type WebContents,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { AnswerWindow } from './answerWindow';
import type { Rect } from './bounds';
import { describeDisplays, effectiveDisplayId, pickScreenSource, type DesktopDisplay } from './capture';
import { localeFromUrl, pickLocale, translate, type Locale } from './i18n';
import { MeetingWatcher } from './meetingWatcher';
import type { MeetingChange } from './meetings';
import {
  allowPermission,
  answerWindowShim,
  commandScript,
  IPC_CHANNELS,
  isAnswerWindowRequest,
  isAppOrigin,
  isExternalWebLink,
  isLivePath,
  isTrustedSender,
  meetingScript,
  reservedAccelerators,
  resolveAppUrl,
  type DesktopCommand,
} from './policy';
import {
  JsonStore,
  normalizeSettings,
  normalizeWindowState,
  parseSettingsPatch,
  type DesktopSettings,
  type SettingsPatch,
  type WindowState,
} from './settings';
import { reconcileShortcuts, registerAll, unregisterAll, type ShortcutErrors, type ShortcutRegistry } from './shortcuts';
import { trayMenuTemplate, type TrayActions } from './trayMenu';

/**
 * Apex Round for Windows (and macOS): the web app in a window, plus what a
 * browser tab can't do on its own:
 * - meeting audio from desktop apps (Zoom, Teams) via system-audio loopback,
 *   from the display the person picks, with no share picker;
 * - global shortcuts that work while the meeting app has focus;
 * - the answer window (what the web app opens as Picture-in-Picture) as
 *   an always-on-top overlay that remembers where it was;
 * - a tray icon, and an offer to start when a meeting app opens the microphone.
 */

const PARTITION = 'persist:apex';

/** The window's colours, from the web app's graphite ramp (src/app/globals.css). */
const COLORS = { page: '#141415', sunken: '#0f0f10', surface: '#19191b', raised: '#232325', text: '#ededed' } as const;
const TITLEBAR_HEIGHT = 36;
/** While the server is unreachable, how often to look for it again. */
const RECOVERY_INTERVAL_MS = 5_000;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A shortcut recording that never ends (the page crashed) gives the shortcuts back after this. */
const PAUSE_LIMIT_MS = 60_000;

function configuredAppUrl(): URL | null {
  let fromConfig: string | undefined;
  try {
    fromConfig = JSON.parse(readFileSync(path.join(__dirname, '..', 'app.config.json'), 'utf8')).appUrl;
  } catch {
    // no config file: development falls back to localhost; a packaged build refuses below
  }
  try {
    return resolveAppUrl(process.env.APEX_APP_URL, fromConfig, { packaged: app.isPackaged });
  } catch (error) {
    dialog.showErrorBox('Apex Round', error instanceof Error ? error.message : String(error));
    return null;
  }
}

const configured = configuredAppUrl();
if (!configured) app.exit(1);
const appUrl = configured as URL;

// Development only: a separate profile (settings, sign-in, single-instance lock) for tests.
if (!app.isPackaged && process.env.APEX_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.APEX_USER_DATA_DIR));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let appIcon: NativeImage | undefined;
let settings: DesktopSettings = normalizeSettings(undefined);
let windowState: WindowState = normalizeWindowState(undefined);
let settingsStore: JsonStore<DesktopSettings> | null = null;
let windowStateStore: JsonStore<WindowState> | null = null;
/** The language of the page shown (or last shown), for the tray, notifications and the offline page. */
let locale: Locale = 'en';
/** The app path the main window shows ('' for the offline page). */
let currentPath = '';
let isQuitting = false;
/** Commands whose shortcut is in settings but held by another app. */
let inactiveShortcuts = new Set<DesktopCommand>();
/** The settings page is recording a new shortcut: ours are off so the keys reach it. */
let shortcutsPaused = false;
let pauseTimer: NodeJS.Timeout | null = null;
let recoveryTimer: NodeJS.Timeout | null = null;
let offlineTarget: string | null = null;
/** Notifications are kept referenced, or their click handler can be garbage-collected. */
const notifications: Notification[] = [];

const answerWindow = new AnswerWindow({
  savedBounds: () => windowState.answerWindow,
  saveBounds: (bounds: Rect) => {
    windowState = { ...windowState, answerWindow: bounds };
    void windowStateStore?.save(windowState);
  },
  onChange: () => refreshTray(),
  backgroundColor: COLORS.page,
  icon: () => appIcon,
});

const meetingWatcher = new MeetingWatcher((change) => onMeetingChange(change), { ownExecutable: process.execPath });

const startUrl = () => new URL(`/${locale}/copilot/live`, appUrl).href;

// ---------------------------------------------------------------------------
// Pages, language and the offline page

/** Tracks which app page the main window shows: its language drives the tray and notifications. */
function onPageChange(url: string, sameDocument: boolean): void {
  const previousPath = currentPath;
  currentPath = isAppOrigin(url, appUrl) ? new URL(url).pathname : '';
  if (currentPath) stopRecovery();
  if (!sameDocument || currentPath !== previousPath) {
    // A page that went away mid-capture or mid-recording can't finish either.
    answerWindow.releaseCapture();
    setShortcutsPaused(false);
  }
  const pageLocale = localeFromUrl(url);
  if (pageLocale && pageLocale !== locale) {
    locale = pageLocale;
    windowState = { ...windowState, locale };
    void windowStateStore?.save(windowState);
  }
  refreshTray();
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The page shown when the server doesn't answer: graphite, in the app's language, Ember only on Retry. */
function offlinePage(target: string): string {
  const origin = escapeHtml(appUrl.origin);
  const body = escapeHtml(translate(locale, app.isPackaged ? 'offlineBody' : 'offlineBodyDev', { origin: appUrl.origin }))
    .replace(origin, `<code>${origin}</code>`)
    .replace('npm run dev', '<code>npm run dev</code>');
  const barPadding = process.platform === 'darwin' ? '0 16px 0 80px' : '0 152px 0 16px';
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Apex Round</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;grid-template-rows:${TITLEBAR_HEIGHT}px 1fr;background:${COLORS.page};color:${COLORS.text};font:14px/1.5 "Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI Variable Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.bar{display:flex;align-items:center;padding:${barPadding};background:${COLORS.sunken};border-bottom:1px solid rgba(237,237,237,.08);color:#85858b;font-size:12px;font-weight:500;user-select:none;-webkit-app-region:drag;app-region:drag}
main{display:grid;place-items:center;padding:24px}
.panel{width:min(440px,100%);padding:24px;border-radius:14px;background:${COLORS.surface};border:1px solid rgba(237,237,237,.08)}
h1{margin:0 0 8px;font-size:18px;font-weight:500;line-height:1.35}
p{margin:0 0 20px;color:#a1a1a6}
code{padding:0 4px;border-radius:4px;background:${COLORS.raised};color:${COLORS.text};font:12px/18px ui-monospace,"Cascadia Mono",Consolas,Menlo,monospace}
a{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;border-radius:8px;background:#ffb547;color:#141415;font-weight:500;text-decoration:none;transition:background-color 140ms cubic-bezier(.22,1,.36,1),transform 140ms cubic-bezier(.22,1,.36,1)}
a:hover{background:#ffc266}
a:active{transform:scale(.98)}
a:focus-visible{outline:2px solid rgba(255,181,71,.75);outline-offset:2px}
</style></head><body>
<div class="bar">Apex Round</div>
<main><div class="panel" role="alert">
<h1>${escapeHtml(translate(locale, 'offlineTitle'))}</h1>
<p>${body}</p>
<a href="${escapeHtml(target)}">${escapeHtml(translate(locale, 'retry'))}</a>
</div></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** Any answer from the server (even a redirect or an error page) means it's back. */
function serverAnswers(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = net.request({ url: `${appUrl.origin}/`, method: 'HEAD', redirect: 'manual' });
    const done = (up: boolean) => {
      clearTimeout(timer);
      request.abort();
      resolve(up);
    };
    const timer = setTimeout(() => done(false), 4_000);
    request.on('response', () => done(true));
    request.on('redirect', () => done(true));
    request.on('error', () => done(false));
    request.end();
  });
}

function showOffline(win: BrowserWindow, failedUrl: string): void {
  offlineTarget = failedUrl;
  void win.loadURL(offlinePage(failedUrl));
  if (recoveryTimer) return;
  // Come back by itself once the server answers (a dev server starting, Wi-Fi returning).
  recoveryTimer = setInterval(() => {
    void serverAnswers().then((up) => {
      const target = offlineTarget;
      if (!up || !target) return;
      stopRecovery();
      if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(target);
    });
  }, RECOVERY_INTERVAL_MS);
}

function stopRecovery(): void {
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryTimer = null;
  offlineTarget = null;
}

// ---------------------------------------------------------------------------
// Session security and capture

/** Only the app gets the mic, screen and system audio; the camera and other sites get nothing. */
function secureSession(ses: Session): void {
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    callback(allowPermission(permission, details.requestingUrl ?? contents.getURL(), appUrl, { mediaTypes }));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const mediaType = 'mediaType' in details ? details.mediaType : undefined;
    return allowPermission(permission, requestingOrigin, appUrl, {
      mediaTypes: mediaType && mediaType !== 'unknown' ? [mediaType] : [],
    });
  });

  // getDisplayMedia: the display chosen in Settings (else the main one) and,
  // on Windows, everything the PC plays (the meeting app's audio). No
  // picker, so nothing to get wrong. Electron's system-audio loopback is
  // Windows-only: on a Mac this captures the screen alone.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const origin = request.securityOrigin || request.frame?.url || '';
      if (!isAppOrigin(origin, appUrl)) {
        callback({});
        return;
      }
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = pickScreenSource(sources, settings.captureDisplayId, String(screen.getPrimaryDisplay().id));
          if (!source) {
            callback({});
            return;
          }
          callback(process.platform === 'win32' && request.audioRequested ? { video: source, audio: 'loopback' } : { video: source });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}

function listDisplays(): DesktopDisplay[] {
  return describeDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id, (n) => translate(locale, 'displayName', { n }));
}

/** The window stays on the app: other links open in the default browser, nothing else opens in-app. */
function lockNavigation(contents: WebContents): void {
  const keepOnApp = (event: { preventDefault(): void }, url: string) => {
    if (isAppOrigin(url, appUrl) || url.startsWith('data:text/html')) return;
    event.preventDefault();
    if (isExternalWebLink(url)) void shell.openExternal(url);
  };
  contents.on('will-navigate', keepOnApp);
  contents.on('will-redirect', keepOnApp);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler((details) => {
    // The answer window: the stand-in's pop-up, from the app's page in the main window only.
    if (isAnswerWindowRequest(details) && contents === mainWindow?.webContents && isAppOrigin(contents.getURL(), appUrl)) {
      return { action: 'allow', overrideBrowserWindowOptions: answerWindow.creationOptions() };
    }
    if (isAppOrigin(details.url, appUrl)) void mainWindow?.loadURL(details.url);
    else if (isExternalWebLink(details.url)) void shell.openExternal(details.url);
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------------------
// The main window

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Apex Round',
    backgroundColor: COLORS.page,
    ...(appIcon ? { icon: appIcon } : {}),
    autoHideMenuBar: true,
    // No OS title bar: the pages draw a drag strip this tall, and the
    // system draws its window buttons over it (right on Windows, left on a Mac).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: COLORS.sunken, symbolColor: COLORS.text, height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      // The live session keeps running behind the meeting app or in the tray:
      // hidden-page timer throttling would delay its transcript and heartbeats.
      backgroundThrottling: false,
      additionalArguments: [`--apex-version=${app.getVersion()}`],
    },
  });
  win.once('ready-to-show', () => win.show());
  const contents = win.webContents;
  contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    // -3 is an aborted load (a redirect or a newer navigation), not an outage.
    if (isMainFrame && errorCode !== -3 && isAppOrigin(url, appUrl)) showOffline(win, url);
  });
  contents.on('did-navigate', (_event, url) => onPageChange(url, false));
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) onPageChange(url, true);
  });
  // Electron 44 can't host Document Picture-in-Picture windows: give the app's
  // pages a stand-in that opens the answer window as a pop-up instead.
  contents.on('dom-ready', () => {
    if (isAppOrigin(contents.getURL(), appUrl)) void contents.executeJavaScript(answerWindowShim(), false).catch(() => undefined);
  });
  contents.on('did-create-window', (child, details) => {
    if (isAnswerWindowRequest(details)) answerWindow.adopt(child);
  });
  contents.on('render-process-gone', () => {
    answerWindow.releaseCapture();
    setShortcutsPaused(false);
  });
  // Recording a shortcut ends when the window loses focus.
  win.on('blur', () => setShortcutsPaused(false));
  // Windows shutdown or sign-out (no before-quit then): never hide instead of closing.
  win.on('session-end', () => {
    isQuitting = true;
  });
  win.on('close', (event) => {
    if (isQuitting || !settings.closeToTray || !tray) return;
    event.preventDefault();
    win.hide();
    showTrayNoticeOnce();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    currentPath = '';
    refreshTray();
  });
  void win.loadURL(startUrl());
  return win;
}

function showMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  const win = mainWindow;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function openLivePage(): void {
  const win = showMainWindow();
  if (!isLivePath(currentPath)) void win.loadURL(new URL(`/${locale}/copilot/live`, appUrl).href);
}

/** Tray → Shortcuts…: the desktop section of Settings, after a warning if that would leave the live page. */
async function openShortcutSettings(): Promise<void> {
  const win = showMainWindow();
  if (isLivePath(currentPath)) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Apex Round',
      message: translate(locale, 'leaveTitle'),
      detail: translate(locale, 'leaveBody'),
      buttons: [translate(locale, 'leaveConfirm'), translate(locale, 'stay')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return;
  }
  void win.loadURL(new URL(`/${locale}/settings#desktop`, appUrl).href);
}

// ---------------------------------------------------------------------------
// Talking to the page

function dispatchToPage(script: string, userGesture: boolean): void {
  const win = mainWindow;
  if (!win || win.isDestroyed() || !isAppOrigin(win.webContents.getURL(), appUrl)) return;
  void win.webContents.executeJavaScript(script, userGesture).catch(() => undefined);
}

/** Runs a shortcut in the page with a user gesture, so it may open the answer window. */
function runCommand(command: DesktopCommand): void {
  dispatchToPage(commandScript(command), true);
}

function notify(title: string, body: string, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, ...(appIcon ? { icon: appIcon } : {}) });
  notification.on('click', onClick);
  notifications.push(notification);
  if (notifications.length > 5) notifications.shift();
  notification.show();
}

function onMeetingChange(change: MeetingChange): void {
  // The page decides what to offer (and shows its own "ending" notice); nothing ends here.
  dispatchToPage(meetingScript(change), false);
  if (change.state !== 'started') return;
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;
  notify(translate(locale, 'meetingTitle', { app: change.app }), translate(locale, 'meetingBody'), () => openLivePage());
}

function showTrayNoticeOnce(): void {
  if (windowState.trayNoticeShown) return;
  windowState = { ...windowState, trayNoticeShown: true };
  void windowStateStore?.save(windowState);
  notify(
    translate(locale, 'trayNoticeTitle'),
    translate(locale, process.platform === 'darwin' ? 'trayNoticeBodyMac' : 'trayNoticeBody'),
    () => showMainWindow(),
  );
}

// ---------------------------------------------------------------------------
// Shortcuts and settings

const shortcutRegistry: ShortcutRegistry = {
  register: (accelerator, command) => globalShortcut.register(accelerator, () => runCommand(command)),
  unregister: (accelerator) => {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      // not an accelerator Electron knows: nothing was registered
    }
  },
};

function registerShortcuts(): void {
  inactiveShortcuts = registerAll(settings.shortcuts, shortcutRegistry);
  for (const command of inactiveShortcuts) {
    console.warn(`[desktop] ${settings.shortcuts[command]} is used by another app; ${command} has no shortcut`);
  }
}

function setShortcutsPaused(paused: boolean): void {
  if (pauseTimer) clearTimeout(pauseTimer);
  pauseTimer = paused ? setTimeout(() => setShortcutsPaused(false), PAUSE_LIMIT_MS) : null;
  if (paused === shortcutsPaused) return;
  shortcutsPaused = paused;
  if (paused) unregisterAll(settings.shortcuts, shortcutRegistry);
  else registerShortcuts();
}

function syncMeetingWatcher(): void {
  if (settings.meetingDetection) meetingWatcher.start();
  else meetingWatcher.stop();
}

/** Saves and applies a change; a refused shortcut keeps its previous value and comes back as an error. */
async function applySettings(patch: SettingsPatch): Promise<{ settings: DesktopSettings; errors: ShortcutErrors }> {
  const next: DesktopSettings = { ...settings, shortcuts: { ...settings.shortcuts } };
  let errors: ShortcutErrors = {};
  if (patch.shortcuts) {
    const result = reconcileShortcuts(settings.shortcuts, patch.shortcuts, shortcutRegistry, {
      reserved: reservedAccelerators(process.platform),
      platform: process.platform,
      inactive: inactiveShortcuts,
    });
    next.shortcuts = result.shortcuts;
    errors = result.errors;
    inactiveShortcuts = result.inactive;
    // Still recording: the new shortcut was tried, and goes live when recording ends.
    if (shortcutsPaused) unregisterAll(next.shortcuts, shortcutRegistry);
  }
  if (patch.captureDisplayId !== undefined) next.captureDisplayId = patch.captureDisplayId;
  if (patch.meetingDetection !== undefined) next.meetingDetection = patch.meetingDetection;
  if (patch.closeToTray !== undefined) next.closeToTray = patch.closeToTray;
  settings = next;
  syncMeetingWatcher();
  refreshTray();
  await settingsStore?.save(settings).catch(() => undefined);
  return { settings, errors };
}

// ---------------------------------------------------------------------------
// IPC: only the app's page in the main window may call, and every input is checked.

function isTrusted(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  const main = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null;
  return isTrustedSender({ webContentsId: event.sender.id, isTopFrame: frame.parent === null, url: frame.url }, main, appUrl);
}

function handle(channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrusted(event)) throw new Error('Not allowed');
    return handler(...args);
  });
}

function registerIpc(): void {
  handle(IPC_CHANNELS.getSettings, () => settings);
  handle(IPC_CHANNELS.setSettings, (patch) => applySettings(parseSettingsPatch(patch)));
  handle(IPC_CHANNELS.listDisplays, () => listDisplays());
  handle(IPC_CHANNELS.hideForCapture, () => answerWindow.hideForCapture());
  handle(IPC_CHANNELS.showAfterCapture, () => answerWindow.showAfterCapture());
  handle(IPC_CHANNELS.pauseShortcuts, (paused) => {
    if (typeof paused !== 'boolean') throw new TypeError('paused must be a boolean');
    setShortcutsPaused(paused);
  });
}

// ---------------------------------------------------------------------------
// Tray

function loadAppIcon(): NativeImage | undefined {
  try {
    // build/icon.png ships inside app.asar (see `files` in electron-builder.js).
    const image = nativeImage.createFromBuffer(readFileSync(path.join(__dirname, '..', 'build', 'icon.png')));
    return image.isEmpty() ? undefined : image;
  } catch {
    return undefined;
  }
}

/** The tray's 16 px icon, with 24 and 32 px versions for scaled displays. */
function trayImage(icon: NativeImage): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 1.5, 2]) {
    const size = Math.round(16 * scaleFactor);
    image.addRepresentation({ scaleFactor, buffer: icon.resize({ width: size, height: size, quality: 'best' }).toPNG() });
  }
  return image;
}

const trayActions: TrayActions = {
  open: () => void showMainWindow(),
  command: (command) => runCommand(command),
  chooseDisplay: (id) => void applySettings({ captureDisplayId: id }),
  setMeetingDetection: (on) => void applySettings({ meetingDetection: on }),
  openShortcuts: () => void openShortcutSettings(),
  quit: () => {
    isQuitting = true;
    app.quit();
  },
};

function createTray(): void {
  if (!appIcon) return; // no icon file: no tray, and closing the window quits
  try {
    tray = new Tray(trayImage(appIcon));
  } catch (error) {
    console.warn('[desktop] no tray icon:', error instanceof Error ? error.message : error);
    return;
  }
  tray.setToolTip('Apex Round');
  // Windows: a click opens the app, a right-click shows the menu. A Mac shows the menu on click.
  if (process.platform !== 'darwin') tray.on('click', () => showMainWindow());
  refreshTray();
}

function refreshTray(): void {
  if (!tray || tray.isDestroyed() || !app.isReady()) return;
  const displays = listDisplays();
  const template = trayMenuTemplate(
    {
      locale,
      onLivePage: mainWindow !== null && isLivePath(currentPath),
      answerWindowOpen: answerWindow.window !== null,
      displays,
      captureDisplayId: effectiveDisplayId(settings.captureDisplayId, displays, String(screen.getPrimaryDisplay().id)),
      meetingDetection: process.platform === 'win32' ? settings.meetingDetection : null,
      shortcuts: settings.shortcuts,
    },
    trayActions,
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Updates

function checkForUpdates(): void {
  // electron-updater fills in {appName} and {version}.
  autoUpdater
    .checkForUpdatesAndNotify({ title: translate(locale, 'updateTitle'), body: translate(locale, 'updateBody') })
    .catch((error: Error) => console.warn('[desktop] update check failed:', error.message));
}

// ---------------------------------------------------------------------------
// App lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.enableSandbox();
  app.setAppUserModelId('com.apexround.desktop');

  app.on('second-instance', () => showMainWindow());
  app.on('web-contents-created', (_event, contents) => lockNavigation(contents));
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => showMainWindow());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    meetingWatcher.stop();
    tray?.destroy();
  });

  void app.whenReady().then(async () => {
    // The app is dark only: native frames, menus and dialogs follow.
    nativeTheme.themeSource = 'dark';
    if (process.platform === 'darwin') {
      // Without an Edit menu, Cmd+C and Cmd+V don't work in a Mac app.
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else if (app.isPackaged) {
      Menu.setApplicationMenu(null);
    }

    const userData = app.getPath('userData');
    settingsStore = new JsonStore(path.join(userData, 'settings.json'), normalizeSettings);
    windowStateStore = new JsonStore(path.join(userData, 'window-state.json'), normalizeWindowState);
    [settings, windowState] = await Promise.all([settingsStore.load(), windowStateStore.load()]);
    locale = windowState.locale ?? pickLocale(app.getPreferredSystemLanguages());

    appIcon = loadAppIcon();
    secureSession(session.fromPartition(PARTITION));
    registerIpc();
    mainWindow = createMainWindow();
    registerShortcuts();
    createTray();
    syncMeetingWatcher();

    const onDisplaysChanged = () => {
      refreshTray();
      answerWindow.keepOnScreen();
    };
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
    screen.on('display-metrics-changed', onDisplaysChanged);

    if (app.isPackaged) {
      checkForUpdates();
      setInterval(checkForUpdates, UPDATE_INTERVAL_MS).unref();
    }
  });
}
