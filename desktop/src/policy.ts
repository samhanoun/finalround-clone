/**
 * The desktop app's rules, kept free of Electron so they can be unit tested:
 * which URL it loads, where the window may navigate, which permissions a page
 * gets, who may call IPC, the commands and their default shortcuts, and the
 * scripts that tell the page about shortcuts and meetings.
 */

/** IPC channels behind window.apexDesktop (preload.ts repeats them; a sandboxed preload can't import). */
export const IPC_CHANNELS = {
  getSettings: 'apex:get-settings',
  setSettings: 'apex:set-settings',
  listDisplays: 'apex:list-displays',
  hideForCapture: 'apex:hide-for-capture',
  showAfterCapture: 'apex:show-after-capture',
  pauseShortcuts: 'apex:pause-shortcuts',
} as const;

export const DEFAULT_APP_URL = 'http://localhost:3000';

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}

/**
 * The web app to load. The app grants that origin silent screen, system-audio
 * and microphone capture, so:
 * - development (`npm start`): APEX_APP_URL, else app.config.json, else
 *   localhost; https, or http on localhost;
 * - a packaged build: app.config.json only, and it must be https on a real
 *   host. A localhost default would hand capture to whatever listens on that
 *   port, and an environment variable could point it anywhere.
 */
export function resolveAppUrl(
  fromEnv: string | undefined,
  fromConfig: string | undefined,
  { packaged = false }: { packaged?: boolean } = {},
): URL {
  if (packaged) {
    const raw = fromConfig?.trim();
    if (!raw) throw new Error('Set "appUrl" in app.config.json to your server (https) before building the app.');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || isLoopback(url.hostname)) {
      throw new Error(`A packaged build needs an https appUrl on a real host, not ${raw}`);
    }
    return url;
  }

  const raw = fromEnv?.trim() || fromConfig?.trim() || DEFAULT_APP_URL;
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error(`The app URL must use https (or http on localhost): ${raw}`);
  }
  return url;
}

export function isAppOrigin(candidate: string, appUrl: URL): boolean {
  try {
    return new URL(candidate).origin === appUrl.origin;
  } catch {
    return false;
  }
}

/** Links that leave the app open in the default browser; only http(s). */
export function isExternalWebLink(candidate: string): boolean {
  try {
    const { protocol } = new URL(candidate);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Chromium asks for a Document Picture-in-Picture window through the
 * window-open handler: about:blank with disposition "other". Electron 44
 * doesn't host those (it drops the window a moment after `requestWindow`
 * resolves), so the app denies them and the page gets the stand-in below.
 */
export function isPictureInPictureRequest(details: { url: string; disposition: string }): boolean {
  return details.url === 'about:blank' && details.disposition === 'other';
}

/** Window names the answer-window stand-in opens: one per request, so a window that's closing is never reused. */
export const ANSWER_WINDOW_NAME = 'apex-answer-window';

/** The stand-in's pop-up: same-origin about:blank under an answer-window name. Other pop-ups stay denied. */
export function isAnswerWindowRequest(details: { url: string; frameName: string; disposition: string }): boolean {
  return (
    details.url === 'about:blank' &&
    details.disposition === 'new-window' &&
    new RegExp(`^${ANSWER_WINDOW_NAME}-\\d{1,9}$`).test(details.frameName)
  );
}

/**
 * The page script that stands in for `documentPictureInPicture` in the
 * desktop app. `requestWindow()` opens a same-origin about:blank pop-up
 * instead, which the main process makes the always-on-top answer window. The
 * web app only needs what both have in common: a Window it can render into,
 * `pagehide` when it closes, and `close()`. It uses nothing but `window.open`,
 * so the page gains no ability it didn't have. Installed once per document.
 */
export function answerWindowShim(): string {
  return `(() => {
  const marker = Symbol.for('apex.answerWindow');
  if (window[marker]) return;
  const events = new EventTarget();
  let current = null;
  let count = 0;
  const size = (value, fallback) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number >= 200 && number <= 4000 ? number : fallback;
  };
  const api = {
    get window() {
      return current && !current.closed ? current : null;
    },
    requestWindow(options) {
      const width = size(options && options.width, 420);
      const height = size(options && options.height, 620);
      if (current && !current.closed) current.close();
      count += 1;
      const win = window.open('', ${JSON.stringify(ANSWER_WINDOW_NAME)} + '-' + count, 'popup,width=' + width + ',height=' + height);
      if (!win) return Promise.reject(new DOMException('The answer window could not open', 'NotAllowedError'));
      current = win;
      win.addEventListener('pagehide', () => {
        if (current === win) current = null;
      }, { once: true });
      queueMicrotask(() => {
        const event = new Event('enter');
        Object.defineProperty(event, 'window', { value: win });
        events.dispatchEvent(event);
      });
      return Promise.resolve(win);
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  try {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, enumerable: true, get: () => api });
    Object.defineProperty(window, marker, { value: true });
  } catch {
    // The page keeps the browser's own API.
  }
})();`;
}

/**
 * Permissions for pages: only the app, and only what the copilot needs
 * (microphone, screen and system audio, clipboard writes for copying
 * answers). The camera is never granted.
 */
export function allowPermission(
  permission: string,
  requestingUrl: string,
  appUrl: URL,
  details: { mediaTypes?: string[] } = {},
): boolean {
  if (!isAppOrigin(requestingUrl, appUrl)) return false;
  switch (permission) {
    case 'media':
      // getUserMedia: audio only. Screen capture goes through the display-media handler instead.
      return (details.mediaTypes ?? []).every((type) => type === 'audio');
    case 'display-capture':
    case 'clipboard-sanitized-write':
    case 'fullscreen':
      return true;
    default:
      return false;
  }
}

/** The commands the web app listens for (src/lib/desktop.ts keeps the same list). */
export const DESKTOP_COMMANDS = ['answer-now', 'solve-screen', 'toggle-answers'] as const;
export type DesktopCommand = (typeof DESKTOP_COMMANDS)[number];

export function isDesktopCommand(value: unknown): value is DesktopCommand {
  return typeof value === 'string' && (DESKTOP_COMMANDS as readonly string[]).includes(value);
}

/**
 * Default global shortcuts, per command. People can change them in Settings
 * (settings.json); src/lib/desktop.ts mirrors these for "Reset".
 */
export const DEFAULT_SHORTCUTS: Readonly<Record<DesktopCommand, string>> = {
  'answer-now': 'CommandOrControl+Shift+A',
  'solve-screen': 'CommandOrControl+Shift+S',
  'toggle-answers': 'CommandOrControl+Shift+H',
};

/** The default shortcuts as accelerator → command. */
export const SHORTCUTS: Record<string, DesktopCommand> = Object.fromEntries(
  DESKTOP_COMMANDS.map((command) => [DEFAULT_SHORTCUTS[command], command]),
);

export type WindowAction = 'left' | 'right' | 'up' | 'down';

/**
 * Fixed shortcuts for the answer window, registered only while it's open so
 * they don't take Ctrl+Alt+Arrows from editors the rest of the time:
 * - modifiers + arrow: move it by 24 px;
 * - modifiers + Shift + arrow: resize it by 24 px;
 * - modifiers + Home: put it back in its default place and size.
 * The modifiers are Ctrl+Alt, or Ctrl+Cmd on a Mac (Ctrl+Option belongs to VoiceOver).
 * No digits or letters: on many European layouts Ctrl+Alt is AltGr, which types characters.
 */
export function answerWindowShortcuts(platform: string): {
  move: Record<WindowAction, string>;
  resize: Record<WindowAction, string>;
  reset: string;
} {
  const base = platform === 'darwin' ? 'Control+Command' : 'Control+Alt';
  const arrows = (prefix: string) => ({
    left: `${prefix}+Left`,
    right: `${prefix}+Right`,
    up: `${prefix}+Up`,
    down: `${prefix}+Down`,
  });
  return { move: arrows(base), resize: arrows(`${base}+Shift`), reset: `${base}+Home` };
}

/** Every fixed answer-window accelerator, so a custom shortcut can't collide with one. */
export function reservedAccelerators(platform: string): string[] {
  const fixed = answerWindowShortcuts(platform);
  return [...Object.values(fixed.move), ...Object.values(fixed.resize), fixed.reset];
}

/** The page script main runs for a shortcut: a DOM event the web app listens for. */
export function commandScript(command: DesktopCommand): string {
  return `window.dispatchEvent(new CustomEvent('apex-desktop:command', { detail: ${JSON.stringify(command)} }));`;
}

export type MeetingEvent = { state: 'started' | 'ended'; app: string };

/** The page script for a meeting app starting or stopping its microphone (see src/lib/desktop.ts). */
export function meetingScript(event: MeetingEvent): string {
  const detail = { state: event.state, app: event.app.slice(0, 40) };
  return `window.dispatchEvent(new CustomEvent('apex-desktop:meeting', { detail: ${JSON.stringify(detail)} }));`;
}

/**
 * IPC is only for the app's own page in the main window: the sender must be
 * that window's top frame, showing the app's origin (not the offline page,
 * not an iframe, not the floating answer window).
 */
export function isTrustedSender(
  sender: { webContentsId: number; isTopFrame: boolean; url: string },
  mainWebContentsId: number | null,
  appUrl: URL,
): boolean {
  return mainWebContentsId !== null && sender.webContentsId === mainWebContentsId && sender.isTopFrame && isAppOrigin(sender.url, appUrl);
}

/** "/es/copilot/live" → true: the page where a live session runs. */
export function isLivePath(pathname: string): boolean {
  return /^\/[a-z]{2}\/copilot\/live\/?$/.test(pathname);
}
