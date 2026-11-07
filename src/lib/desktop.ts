/**
 * The bridge to the desktop app (desktop/). Its preload sets
 * `window.apexDesktop`; its global shortcuts arrive as DOM events that the
 * main process dispatches with a user gesture, so a shortcut may open the
 * floating answer window. Meeting detection arrives the same way, as
 * `apex-desktop:meeting` events.
 *
 * Every optional member may be missing (an older desktop build, or the web
 * app in a browser), so callers go through the helpers below.
 */

export const DESKTOP_COMMANDS = ['answer-now', 'solve-screen', 'toggle-answers'] as const;
export type DesktopCommand = (typeof DESKTOP_COMMANDS)[number];

export const DESKTOP_COMMAND_EVENT = 'apex-desktop:command';
export const DESKTOP_MEETING_EVENT = 'apex-desktop:meeting';

/** A meeting app started or stopped using the microphone (Zoom, Teams, Webex…). */
export type DesktopMeetingEvent = { state: 'started' | 'ended'; app: string };

export type DesktopDisplay = { id: string; label: string; primary: boolean; width: number; height: number };

/** Desktop-only preferences, kept by the desktop app (not in the account). */
export type DesktopSettings = {
  /** Which display Start listening and Solve screen capture; null = the primary display. */
  captureDisplayId: string | null;
  /** Global shortcuts, as Electron accelerators ("CommandOrControl+Shift+A"); '' = no shortcut. */
  shortcuts: Record<DesktopCommand, string>;
  /** Offer to start when a meeting app starts using the microphone. */
  meetingDetection: boolean;
  /** Keep running in the tray when the window is closed. */
  closeToTray: boolean;
};

/**
 * Why a shortcut change was refused: `taken` (another app, another command or
 * an answer-window shortcut uses it) or `invalid` (not a usable shortcut).
 * The command keeps its previous shortcut.
 */
export type DesktopShortcutError = 'taken' | 'invalid';

export type DesktopSettingsResult = {
  settings: DesktopSettings;
  errors: Partial<Record<DesktopCommand, DesktopShortcutError>>;
};

/** The desktop app's default shortcuts (desktop/src/policy.ts), for "Reset". */
export const DESKTOP_DEFAULT_SHORTCUTS: Readonly<Record<DesktopCommand, string>> = {
  'answer-now': 'CommandOrControl+Shift+A',
  'solve-screen': 'CommandOrControl+Shift+S',
  'toggle-answers': 'CommandOrControl+Shift+H',
};

type DesktopBridge = {
  isDesktop: true;
  platform: string;
  version?: string;
  /** Hides the floating answer window until `showAfterCapture`; resolves once it's off screen. */
  hideForCapture?: () => Promise<void>;
  showAfterCapture?: () => Promise<void>;
  getSettings?: () => Promise<DesktopSettings>;
  /** Saves and applies a change; resolves with the settings now in force (a taken shortcut is refused). */
  setSettings?: (patch: Partial<DesktopSettings>) => Promise<DesktopSettingsResult>;
  listDisplays?: () => Promise<DesktopDisplay[]>;
  /** Turns the global shortcuts off while Settings records a new one, so the keys reach the page. */
  pauseShortcuts?: (paused: boolean) => Promise<void>;
};

function bridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const value = (window as Window & { apexDesktop?: Partial<DesktopBridge> }).apexDesktop;
  return value?.isDesktop === true ? (value as DesktopBridge) : null;
}

export function isDesktopApp(): boolean {
  return bridge() !== null;
}

/** The desktop app's OS ('win32', 'darwin'…), or null in a browser. */
export function desktopPlatform(): string | null {
  return bridge()?.platform ?? null;
}

/**
 * Pauses the desktop app's global shortcuts while a new one is recorded (they
 * would otherwise swallow the keys), and resumes them. No-op in a browser or
 * an older desktop build; the desktop app also resumes them on its own when
 * the window loses focus or the page goes away.
 */
export async function pauseDesktopShortcuts(paused: boolean): Promise<void> {
  await bridge()?.pauseShortcuts?.(paused).catch(() => undefined);
}

/** The desktop app's settings API, or null in a browser or an older desktop build. */
export function desktopSettingsApi(): Required<Pick<DesktopBridge, 'getSettings' | 'setSettings' | 'listDisplays'>> | null {
  const b = bridge();
  if (!b?.getSettings || !b.setSettings || !b.listDisplays) return null;
  return { getSettings: b.getSettings, setSettings: b.setSettings, listDisplays: b.listDisplays };
}

/**
 * Runs a screen capture with the floating answer window out of the picture
 * (desktop app only), so Solve screen never reads its own answer. In a
 * browser it just runs the capture.
 */
export async function withAnswerWindowHidden<T>(capture: () => Promise<T>): Promise<T> {
  const b = bridge();
  if (!b?.hideForCapture || !b.showAfterCapture) return capture();
  await b.hideForCapture().catch(() => undefined);
  try {
    return await capture();
  } finally {
    await b.showAfterCapture().catch(() => undefined);
  }
}

/** Desktop shortcuts (Ctrl+Shift+A/S/H by default). Unknown commands are ignored. */
export function onDesktopCommand(listener: (command: DesktopCommand) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    const command = (event as CustomEvent<unknown>).detail;
    if (typeof command === 'string' && (DESKTOP_COMMANDS as readonly string[]).includes(command)) {
      listener(command as DesktopCommand);
    }
  };
  window.addEventListener(DESKTOP_COMMAND_EVENT, handler);
  return () => window.removeEventListener(DESKTOP_COMMAND_EVENT, handler);
}

/** A meeting app started or stopped using the microphone (desktop app only). */
export function onDesktopMeeting(listener: (event: DesktopMeetingEvent) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail as Partial<DesktopMeetingEvent> | null;
    if (detail && (detail.state === 'started' || detail.state === 'ended') && typeof detail.app === 'string') {
      listener({ state: detail.state, app: detail.app.slice(0, 40) });
    }
  };
  window.addEventListener(DESKTOP_MEETING_EVENT, handler);
  return () => window.removeEventListener(DESKTOP_MEETING_EVENT, handler);
}
