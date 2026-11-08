import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isUsableGlobalShortcut, normalizeAccelerator } from './accelerator';
import { DEFAULT_SHORTCUTS, DESKTOP_COMMANDS, type DesktopCommand } from './policy';
import { normalizeRect, type Rect } from './bounds';
import { isLocale, type Locale } from './i18n';

/**
 * The desktop app's own preferences (userData/settings.json) and window
 * state (userData/window-state.json). Same shape as `DesktopSettings` in
 * src/lib/desktop.ts. Everything read from disk or IPC is validated here.
 */

export type DesktopSettings = {
  /** Which display Start listening and Solve screen capture; null = the main display. */
  captureDisplayId: string | null;
  /** Global shortcuts as Electron accelerators; '' = no shortcut. */
  shortcuts: Record<DesktopCommand, string>;
  /** Offer to start when a meeting app starts using the microphone (Windows). */
  meetingDetection: boolean;
  /** Closing the window hides it to the tray instead of quitting. */
  closeToTray: boolean;
};

export function defaultSettings(): DesktopSettings {
  return {
    captureDisplayId: null,
    shortcuts: { ...DEFAULT_SHORTCUTS },
    meetingDetection: true,
    closeToTray: true,
  };
}

const DISPLAY_ID = /^[\w.:-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storedShortcut(value: unknown, fallback: string): string {
  if (value === '') return '';
  if (typeof value !== 'string') return fallback;
  const accelerator = normalizeAccelerator(value);
  return accelerator && isUsableGlobalShortcut(accelerator) ? accelerator : fallback;
}

/** Any parsed settings.json (old, hand-edited or broken) → valid settings; bad values fall back to defaults. */
export function normalizeSettings(raw: unknown): DesktopSettings {
  const defaults = defaultSettings();
  if (!isRecord(raw)) return defaults;
  const shortcuts = isRecord(raw.shortcuts) ? raw.shortcuts : {};
  return {
    captureDisplayId:
      typeof raw.captureDisplayId === 'string' && DISPLAY_ID.test(raw.captureDisplayId) ? raw.captureDisplayId : null,
    shortcuts: Object.fromEntries(
      DESKTOP_COMMANDS.map((command) => [command, storedShortcut(shortcuts[command], defaults.shortcuts[command])]),
    ) as Record<DesktopCommand, string>,
    meetingDetection: typeof raw.meetingDetection === 'boolean' ? raw.meetingDetection : defaults.meetingDetection,
    closeToTray: typeof raw.closeToTray === 'boolean' ? raw.closeToTray : defaults.closeToTray,
  };
}

/** A change sent by the page. Shortcut values stay raw: reconcileShortcuts reports bad ones as `invalid`. */
export type SettingsPatch = {
  captureDisplayId?: string | null;
  shortcuts?: Partial<Record<DesktopCommand, unknown>>;
  meetingDetection?: boolean;
  closeToTray?: boolean;
};

/** Validates a patch from IPC. Unknown keys are ignored; a wrongly typed value throws. */
export function parseSettingsPatch(raw: unknown): SettingsPatch {
  if (!isRecord(raw)) throw new TypeError('settings patch must be an object');
  const patch: SettingsPatch = {};
  if ('captureDisplayId' in raw) {
    const id = raw.captureDisplayId;
    if (id !== null && !(typeof id === 'string' && DISPLAY_ID.test(id))) throw new TypeError('captureDisplayId must be a display id or null');
    patch.captureDisplayId = id;
  }
  if ('shortcuts' in raw) {
    if (!isRecord(raw.shortcuts)) throw new TypeError('shortcuts must be an object');
    const shortcuts: Partial<Record<DesktopCommand, unknown>> = {};
    for (const command of DESKTOP_COMMANDS) {
      if (command in raw.shortcuts) shortcuts[command] = raw.shortcuts[command];
    }
    patch.shortcuts = shortcuts;
  }
  for (const key of ['meetingDetection', 'closeToTray'] as const) {
    if (!(key in raw)) continue;
    if (typeof raw[key] !== 'boolean') throw new TypeError(`${key} must be a boolean`);
    patch[key] = raw[key] as boolean;
  }
  return patch;
}

/** What the app remembers between sessions, apart from preferences. */
export type WindowState = {
  /** Where the floating answer window was last left. */
  answerWindow: Rect | null;
  /** The language of the last page shown, for the tray and the next start. */
  locale: Locale | null;
  /** The "still running in the tray" notice is shown once. */
  trayNoticeShown: boolean;
};

export function normalizeWindowState(raw: unknown): WindowState {
  const state = isRecord(raw) ? raw : {};
  return {
    answerWindow: normalizeRect(state.answerWindow),
    locale: isLocale(state.locale) ? state.locale : null,
    trayNoticeShown: state.trayNoticeShown === true,
  };
}

/** Reads and parses a JSON file; undefined when it's missing or not JSON. */
export async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Writes JSON so a crash never leaves a half-written file: a temporary file
 * in the same folder, flushed, then renamed over the old one (retried
 * briefly when antivirus or a backup tool holds the file on Windows).
 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const handle = await fs.open(temp, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) {
        await fs.rm(temp, { force: true });
        throw error;
      }
      await sleep(50 * (attempt + 1));
    }
  }
}

/**
 * A JSON file read once and written in order: saves queue behind each other,
 * so the file always ends with the latest value.
 */
export class JsonStore<T> {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly file: string,
    private readonly normalize: (raw: unknown) => T,
  ) {}

  async load(): Promise<T> {
    return this.normalize(await readJsonFile(this.file));
  }

  save(value: T): Promise<void> {
    const write = this.queue.then(() => writeJsonAtomic(this.file, value));
    this.queue = write.catch((error: Error) => console.warn('[desktop] could not save %s:', path.basename(this.file), error.message));
    return write;
  }
}
