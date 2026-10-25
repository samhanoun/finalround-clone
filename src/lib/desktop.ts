/**
 * The bridge to the Windows desktop app (desktop/). Its preload sets
 * `window.apexDesktop`; its global shortcuts arrive as DOM events that the
 * main process dispatches with a user gesture, so a shortcut may open the
 * floating answer window.
 */

export const DESKTOP_COMMANDS = ['answer-now', 'solve-screen', 'toggle-answers'] as const;
export type DesktopCommand = (typeof DESKTOP_COMMANDS)[number];

export const DESKTOP_COMMAND_EVENT = 'apex-desktop:command';

type DesktopBridge = { isDesktop: true; platform: string };

function bridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const value = (window as Window & { apexDesktop?: Partial<DesktopBridge> }).apexDesktop;
  return value?.isDesktop === true ? (value as DesktopBridge) : null;
}

export function isDesktopApp(): boolean {
  return bridge() !== null;
}

/** Desktop shortcuts (Ctrl+Shift+A/S/H). Unknown commands are ignored. */
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
