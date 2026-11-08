import { globalShortcut, screen, type BrowserWindow, type BrowserWindowConstructorOptions, type NativeImage } from 'electron';
import { ANSWER_WINDOW, defaultAnswerBounds, keepVisible, moveBy, resizeBy, type Direction, type Rect } from './bounds';
import { answerWindowShortcuts } from './policy';

/**
 * The floating answer window. The web app asks for it with
 * `documentPictureInPicture.requestWindow()`; Electron 44 can't host those
 * windows, so in the desktop app that call opens a same-origin pop-up
 * (policy.ts answerWindowShim), which the main window's window-open handler
 * lets through. This makes that window an overlay that behaves:
 * - always on top, at the level that also covers full-screen meeting apps;
 * - where it was left last time (kept on a screen that still exists);
 * - moved and resized from the keyboard while it's open;
 * - out of the picture while Solve screen grabs a frame.
 * It is deliberately not hidden from screen sharing (no content protection).
 */

/** How long a hidden window takes to leave the captured frames: about two frames at the capture rate. */
const CAPTURE_SETTLE_MS = 120;
/** If the page never says the capture is over (it crashed), the window comes back anyway. */
const CAPTURE_SAFETY_MS = 15_000;
const SAVE_DELAY_MS = 400;

type Options = {
  savedBounds: () => Rect | null;
  saveBounds: (bounds: Rect) => void;
  /** Opened or closed: the tray menu changes. */
  onChange: () => void;
  backgroundColor: string;
  /** The app icon, once it's loaded. */
  icon: () => NativeImage | undefined;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AnswerWindow {
  private win: BrowserWindow | null = null;
  private holds = 0;
  private hidden = false;
  private hiddenAt = 0;
  private refocus = false;
  private safetyTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  /** Where the window was when the waiting save was scheduled (written even if it closes first). */
  private pendingBounds: Rect | null = null;
  private registered: string[] = [];

  constructor(private readonly options: Options) {}

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  private workAreas(): Rect[] {
    return screen.getAllDisplays().map((display) => display.workArea);
  }

  private placement(): Rect {
    const saved = this.options.savedBounds();
    return saved ? keepVisible(saved, this.workAreas()) : defaultAnswerBounds(screen.getPrimaryDisplay().workArea);
  }

  /** Options for the window-open handler, so the window appears in place instead of jumping there. */
  creationOptions(): BrowserWindowConstructorOptions {
    const icon = this.options.icon();
    return {
      ...this.placement(),
      minWidth: ANSWER_WINDOW.minWidth,
      minHeight: ANSWER_WINDOW.minHeight,
      alwaysOnTop: true,
      // An overlay, not another app window: no taskbar button, nothing to minimise it into.
      skipTaskbar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: this.options.backgroundColor,
      ...(icon ? { icon } : {}),
    };
  }

  /** Takes over the BrowserWindow Electron created for the answer window's pop-up. */
  adopt(win: BrowserWindow): void {
    this.win = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const placement = this.placement();
    const bounds = win.getBounds();
    if (bounds.x !== placement.x || bounds.y !== placement.y || bounds.width !== placement.width || bounds.height !== placement.height) {
      win.setBounds(placement);
    }
    win.on('moved', () => this.scheduleSave());
    win.on('resized', () => this.scheduleSave());
    win.on('show', () => win.setAlwaysOnTop(true, 'screen-saver'));
    // A close from the OS (the window's X) comes with 'close'. One from the page ("Bring back
    // here", the session ending) only with 'closed', so a move it cut short is written then.
    win.on('close', () => this.saveNow(win));
    win.once('closed', () => {
      if (this.win !== win) return;
      this.flushPendingSave();
      this.win = null;
      this.unregisterShortcuts();
      this.holds = 0;
      this.hidden = false;
      this.clearSafety();
      this.options.onChange();
    });
    this.registerShortcuts();
    this.options.onChange();
  }

  /** Hides the window until `showAfterCapture`; resolves once it's out of the captured frames. */
  async hideForCapture(): Promise<void> {
    this.holds += 1;
    if (!this.hidden) {
      const win = this.window;
      if (!win || !win.isVisible()) return;
      this.refocus = win.isFocused();
      win.hide();
      this.hidden = true;
      this.hiddenAt = Date.now();
      this.clearSafety();
      this.safetyTimer = setTimeout(() => this.releaseCapture(), CAPTURE_SAFETY_MS);
    }
    const wait = CAPTURE_SETTLE_MS - (Date.now() - this.hiddenAt);
    if (wait > 0) await sleep(wait);
  }

  /** Shows the window again once every capture that hid it is done, without taking the focus. */
  showAfterCapture(): void {
    this.holds = Math.max(0, this.holds - 1);
    if (this.holds === 0) this.restore();
  }

  /** The page went away mid-capture (navigation, crash): bring the window back. */
  releaseCapture(): void {
    this.holds = 0;
    this.restore();
  }

  private restore(): void {
    this.clearSafety();
    if (!this.hidden) return;
    this.hidden = false;
    const win = this.window;
    if (!win) return;
    // Back to the focus it had: the meeting app keeps it unless the answer window had it.
    if (this.refocus) win.show();
    else win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  private clearSafety(): void {
    if (this.safetyTimer) clearTimeout(this.safetyTimer);
    this.safetyTimer = null;
  }

  /** After a display change: pull the window back onto a screen that exists. */
  keepOnScreen(): void {
    const win = this.window;
    if (!win) return;
    const bounds = win.getBounds();
    const visible = keepVisible(bounds, this.workAreas());
    if (visible.x !== bounds.x || visible.y !== bounds.y || visible.width !== bounds.width || visible.height !== bounds.height) {
      win.setBounds(visible);
      this.scheduleSave();
    }
  }

  private step(kind: 'move' | 'resize', direction: Direction): void {
    const win = this.window;
    if (!win || this.hidden) return;
    const areas = this.workAreas();
    const bounds = win.getBounds();
    win.setBounds(kind === 'move' ? moveBy(bounds, direction, areas) : resizeBy(bounds, direction, areas));
    this.scheduleSave();
  }

  /** Back to the default corner and size. */
  resetPlacement(): void {
    const win = this.window;
    if (!win) return;
    win.setBounds(defaultAnswerBounds(screen.getPrimaryDisplay().workArea));
    this.scheduleSave();
  }

  /** Only while the window is open, so Ctrl+Alt+Arrows stay with editors the rest of the time. */
  private registerShortcuts(): void {
    if (this.registered.length > 0) return;
    const keys = answerWindowShortcuts(process.platform);
    const bind = (accelerator: string, action: () => void) => {
      try {
        if (globalShortcut.register(accelerator, action)) this.registered.push(accelerator);
        else console.warn(`[desktop] ${accelerator} is used by another app; the answer window can't use it`);
      } catch (error) {
        console.warn('[desktop] could not register %s:', accelerator, error instanceof Error ? error.message : error);
      }
    };
    for (const direction of ['left', 'right', 'up', 'down'] as const) {
      bind(keys.move[direction], () => this.step('move', direction));
      bind(keys.resize[direction], () => this.step('resize', direction));
    }
    bind(keys.reset, () => this.resetPlacement());
  }

  private unregisterShortcuts(): void {
    for (const accelerator of this.registered) globalShortcut.unregister(accelerator);
    this.registered = [];
  }

  private scheduleSave(): void {
    const win = this.window;
    if (!win) return;
    this.pendingBounds = win.getBounds();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const current = this.window;
      const bounds = current ? current.getBounds() : this.pendingBounds;
      this.pendingBounds = null;
      if (bounds) this.options.saveBounds(bounds);
    }, SAVE_DELAY_MS);
  }

  /** Writes a save still waiting on its timer, from where the window last was. */
  private flushPendingSave(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const bounds = this.pendingBounds;
    this.pendingBounds = null;
    if (bounds) this.options.saveBounds(bounds);
  }

  private saveNow(win: BrowserWindow): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.pendingBounds = null;
    if (!win.isDestroyed()) this.options.saveBounds(win.getBounds());
  }
}
