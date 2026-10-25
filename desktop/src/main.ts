import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  Menu,
  screen,
  session,
  shell,
  type Session,
  type WebContents,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import {
  allowPermission,
  commandScript,
  isAppOrigin,
  isExternalWebLink,
  isPictureInPictureRequest,
  resolveAppUrl,
  SHORTCUTS,
  type DesktopCommand,
} from './policy';

/**
 * Apex Round for Windows: the web app in a window, plus what a browser tab
 * can't do on its own:
 * - meeting audio from desktop apps (Zoom, Teams) via system-audio loopback,
 *   with no share picker;
 * - global shortcuts that work while the meeting app has focus.
 * The answer window is the web app's own Picture-in-Picture window, which
 * Electron supports as Chrome does.
 */

const PARTITION = 'persist:apex';
const START_PATH = '/en/copilot/live';

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
let mainWindow: BrowserWindow | null = null;

/** The window's colours, shared with the web app's "Night console" tokens. */
const MIDNIGHT = '#0b1324';
const PAPER = '#e8edf7';
const TITLEBAR_HEIGHT = 36;

function offlinePage(url: URL): string {
  const target = new URL(START_PATH, url).href;
  const html = `<!doctype html><meta charset="utf-8"><title>Apex Round</title>
<style>
body{margin:0;height:100vh;display:grid;grid-template-rows:${TITLEBAR_HEIGHT}px 1fr;background:${MIDNIGHT};color:${PAPER};font:15px/1.6 "Segoe UI",system-ui,sans-serif}
.bar{display:flex;align-items:center;padding:0 152px 0 18px;border-bottom:1px solid #18233a;color:#93a1bf;font-size:12.5px;font-weight:500;-webkit-app-region:drag}
main{display:grid;place-content:center;padding:24px}
.panel{max-width:440px;padding:28px 30px;border-radius:18px;background:#111b30;border:1px solid #243250}
h1{margin:0 0 8px;font-size:20px;font-weight:600}
p{margin:0 0 20px;color:#93a1bf}
code{padding:1px 6px;border-radius:6px;background:#070c18;color:${PAPER};font:13px Consolas,monospace}
a{display:inline-flex;align-items:center;height:44px;padding:0 18px;border-radius:10px;background:#ffb547;color:${MIDNIGHT};font-weight:600;text-decoration:none}
a:focus-visible{outline:2px solid #ffb547;outline-offset:3px}
</style>
<div class="bar">Apex Round</div>
<main><div class="panel">
<h1>Can't reach Apex Round</h1>
<p>Nothing answered at ${url.origin}. Start the web app (<code>npm run dev</code>) or set the app URL, then retry.</p>
<a href="${target}">Retry</a>
</div></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

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

  // getDisplayMedia: the primary screen, and on Windows everything the PC
  // plays (the meeting app's audio). No picker, so nothing to get wrong.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const origin = request.securityOrigin || request.frame?.url || '';
      if (!isAppOrigin(origin, appUrl)) {
        callback({});
        return;
      }
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const primary = String(screen.getPrimaryDisplay().id);
          const source = sources.find((candidate) => candidate.display_id === primary) ?? sources[0];
          if (!source) {
            callback({});
            return;
          }
          callback(process.platform === 'win32' ? { video: source, audio: 'loopback' } : { video: source });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
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
    // The app's floating answer window (Document Picture-in-Picture).
    if (isPictureInPictureRequest(details) && isAppOrigin(contents.getURL(), appUrl)) return { action: 'allow' };
    if (isAppOrigin(details.url, appUrl)) void mainWindow?.loadURL(details.url);
    else if (isExternalWebLink(details.url)) void shell.openExternal(details.url);
    return { action: 'deny' };
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Apex Round',
    backgroundColor: MIDNIGHT,
    autoHideMenuBar: true,
    // No OS title bar: the pages draw a drag strip this tall, and Windows
    // draws its window buttons over the strip's right end.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: MIDNIGHT, symbolColor: PAPER, height: TITLEBAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    // -3 is an aborted load (a redirect or a newer navigation), not an outage.
    if (isMainFrame && errorCode !== -3 && isAppOrigin(url, appUrl)) void win.loadURL(offlinePage(appUrl));
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(new URL(START_PATH, appUrl).href);
  return win;
}

/** Runs a shortcut in the page with a user gesture, so it may open the answer window. */
function runCommand(command: DesktopCommand): void {
  const win = mainWindow;
  if (!win || win.isDestroyed() || !isAppOrigin(win.webContents.getURL(), appUrl)) return;
  void win.webContents.executeJavaScript(commandScript(command), true).catch(() => undefined);
}

function registerShortcuts(): void {
  for (const [accelerator, command] of Object.entries(SHORTCUTS)) {
    if (!globalShortcut.register(accelerator, () => runCommand(command))) {
      console.warn(`[desktop] ${accelerator} is already used by another app; ${command} has no shortcut`);
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.enableSandbox();
  app.setAppUserModelId('com.apexround.desktop');

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('web-contents-created', (_event, contents) => lockNavigation(contents));
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());

  void app.whenReady().then(() => {
    if (app.isPackaged) Menu.setApplicationMenu(null);
    secureSession(session.fromPartition(PARTITION));
    mainWindow = createMainWindow();
    registerShortcuts();
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch((error: Error) => console.warn('[desktop] update check failed:', error.message));
    }
  });
}
