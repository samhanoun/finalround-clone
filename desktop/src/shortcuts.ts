import { isUsableGlobalShortcut, normalizeAccelerator, sameAccelerator } from './accelerator';
import { DESKTOP_COMMANDS, type DesktopCommand } from './policy';

/**
 * Applying shortcut changes: validate, refuse collisions, register, and fall
 * back to the previous shortcut when another app holds the new one. Pure
 * apart from the registry it's given (Electron's globalShortcut in main.ts, a
 * fake in the tests).
 */

export type Shortcuts = Record<DesktopCommand, string>;
export type ShortcutError = 'taken' | 'invalid';
export type ShortcutErrors = Partial<Record<DesktopCommand, ShortcutError>>;

export interface ShortcutRegistry {
  /** False when another app holds it; may throw for an accelerator Electron can't parse. */
  register(accelerator: string, command: DesktopCommand): boolean;
  unregister(accelerator: string): void;
}

function tryRegister(registry: ShortcutRegistry, accelerator: string, command: DesktopCommand): 'ok' | ShortcutError {
  try {
    return registry.register(accelerator, command) ? 'ok' : 'taken';
  } catch {
    return 'invalid';
  }
}

/** Registers every non-empty shortcut; returns the commands it couldn't register (another app holds them). */
export function registerAll(shortcuts: Shortcuts, registry: ShortcutRegistry): Set<DesktopCommand> {
  const inactive = new Set<DesktopCommand>();
  for (const command of DESKTOP_COMMANDS) {
    const accelerator = shortcuts[command];
    if (accelerator && tryRegister(registry, accelerator, command) !== 'ok') inactive.add(command);
  }
  return inactive;
}

export function unregisterAll(shortcuts: Shortcuts, registry: ShortcutRegistry): void {
  for (const command of DESKTOP_COMMANDS) {
    if (shortcuts[command]) registry.unregister(shortcuts[command]);
  }
}

type Options = {
  /** Accelerators the app uses for something else (the answer window's fixed shortcuts). */
  reserved: readonly string[];
  platform: string;
  /** Commands whose current shortcut isn't registered (another app held it at startup). */
  inactive?: ReadonlySet<DesktopCommand>;
};

/**
 * Applies `requested` (command → accelerator, '' to clear) on top of
 * `current`, which is registered right now. Returns the shortcuts now in
 * force, an error per refused change, and the commands left unregistered:
 * - `invalid`: not an accelerator, or not usable globally (no Ctrl/Alt/Cmd/Win);
 * - `taken`: another command or a fixed answer-window shortcut uses it, or
 *   another app holds it.
 * A refused change keeps the command's previous shortcut. Asking again for
 * a shortcut that's in settings but unregistered retries it.
 */
export function reconcileShortcuts(
  current: Shortcuts,
  requested: Partial<Record<DesktopCommand, unknown>>,
  registry: ShortcutRegistry,
  { reserved, platform, inactive = new Set() }: Options,
): { shortcuts: Shortcuts; errors: ShortcutErrors; inactive: Set<DesktopCommand> } {
  const next: Shortcuts = { ...current };
  const errors: ShortcutErrors = {};
  const changing: DesktopCommand[] = [];

  for (const command of DESKTOP_COMMANDS) {
    if (!(command in requested)) continue;
    const raw = requested[command];
    if (raw === '') {
      if (current[command] !== '') {
        next[command] = '';
        changing.push(command);
      }
      continue;
    }
    const accelerator = typeof raw === 'string' ? normalizeAccelerator(raw) : null;
    if (!accelerator || !isUsableGlobalShortcut(accelerator)) {
      errors[command] = 'invalid';
      continue;
    }
    const unchanged = sameAccelerator(accelerator, current[command], platform);
    if (unchanged && !inactive.has(command)) continue;
    next[command] = unchanged ? current[command] : accelerator;
    changing.push(command);
  }

  // Collisions with the fixed shortcuts or with another command's (new) shortcut.
  const clashes = (command: DesktopCommand) => {
    const accelerator = next[command];
    if (!accelerator) return false;
    if (reserved.some((other) => sameAccelerator(other, accelerator, platform))) return true;
    return DESKTOP_COMMANDS.some((other) => other !== command && sameAccelerator(next[other], accelerator, platform));
  };
  for (let pass = 0; pass < DESKTOP_COMMANDS.length; pass += 1) {
    let reverted = false;
    for (const command of changing) {
      if (next[command] === current[command] || !clashes(command)) continue;
      errors[command] = 'taken';
      next[command] = current[command];
      reverted = true;
    }
    if (!reverted) break;
  }
  // A revert can still collide (two changes that traded places): clear it rather than double-book.
  for (const command of changing) {
    if (clashes(command)) next[command] = '';
  }

  // Free the old shortcuts first, so two commands can trade places.
  for (const command of changing) {
    if (current[command]) registry.unregister(current[command]);
  }
  const unregistered = new Set([...inactive].filter((command) => !changing.includes(command)));
  for (const command of changing) {
    const accelerator = next[command];
    if (!accelerator) continue;
    const result = tryRegister(registry, accelerator, command);
    if (result === 'ok') continue;
    if (accelerator === current[command]) {
      // Its previous shortcut (a retry, or a revert after a clash): keep it in settings, unregistered.
      errors[command] ??= result;
      unregistered.add(command);
      continue;
    }
    errors[command] = result;
    const previous = current[command];
    const previousFree =
      previous !== '' && !DESKTOP_COMMANDS.some((other) => other !== command && sameAccelerator(next[other], previous, platform));
    if (!previousFree) {
      next[command] = '';
      continue;
    }
    next[command] = previous;
    if (tryRegister(registry, previous, command) !== 'ok') unregistered.add(command);
  }

  return { shortcuts: next, errors, inactive: unregistered };
}
