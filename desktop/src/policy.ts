/**
 * The desktop app's rules, kept free of Electron so they can be unit tested:
 * which URL it loads, where the window may navigate, which permissions a page
 * gets, and the global shortcuts.
 */

export const DEFAULT_APP_URL = 'http://localhost:3000';

/**
 * The web app to load: APEX_APP_URL (for development), else app.config.json.
 * Plain http is only accepted for localhost, where capture still counts as a
 * secure context.
 */
export function resolveAppUrl(fromEnv: string | undefined, fromConfig: string | undefined): URL {
  const raw = fromEnv?.trim() || fromConfig?.trim() || DEFAULT_APP_URL;
  const url = new URL(raw);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
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
 * Chromium creates the Document Picture-in-Picture window (the floating answer
 * window) through the window-open handler: about:blank with disposition
 * "other". Ordinary pop-ups are "new-window" (or a tab) and stay denied.
 */
export function isPictureInPictureRequest(details: { url: string; disposition: string }): boolean {
  return details.url === 'about:blank' && details.disposition === 'other';
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

export type DesktopCommand = 'answer-now' | 'solve-screen' | 'toggle-answers';

/** Global shortcuts: they work while the meeting app has focus. */
export const SHORTCUTS: Record<string, DesktopCommand> = {
  'CommandOrControl+Shift+A': 'answer-now',
  'CommandOrControl+Shift+S': 'solve-screen',
  'CommandOrControl+Shift+H': 'toggle-answers',
};

/** The page script main runs for a shortcut: a DOM event the web app listens for. */
export function commandScript(command: DesktopCommand): string {
  return `window.dispatchEvent(new CustomEvent('apex-desktop:command', { detail: ${JSON.stringify(command)} }));`;
}
