/**
 * Keyboard shortcuts for the desktop settings: turning a key press into an
 * Electron accelerator ("CommandOrControl+Shift+K"), comparing two of them,
 * and splitting one into keycaps. The desktop app validates again
 * (desktop/src/accelerator.ts); this side gives quick, specific feedback.
 */

/** What a key press means while a shortcut is being recorded. */
export type RecordedKeys =
  | { type: 'modifiers' } // only modifiers so far: keep listening
  | { type: 'cancel' } // Esc
  | { type: 'clear' } // Backspace or Delete: no shortcut
  | { type: 'tab' } // Tab: leave the field, keyboard users mustn't get stuck
  | { type: 'invalid' } // a key that can't be a global shortcut
  | { type: 'accelerator'; accelerator: string };

export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'Super', 'Hyper', 'Fn', 'FnLock']);

const STANDALONE = /^(F([1-9]|1\d|2[0-4])|MediaPlayPause|MediaNextTrack|MediaPreviousTrack|MediaStop|VolumeUp|VolumeDown|VolumeMute)$/;

/** Physical keys by KeyboardEvent.code, as Electron names them. */
const CODE_NAMES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  PrintScreen: 'PrintScreen',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadDecimal: 'numdec',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaStop: 'MediaStop',
  AudioVolumeUp: 'VolumeUp',
  AudioVolumeDown: 'VolumeDown',
  AudioVolumeMute: 'VolumeMute',
};

function keyName({ key, code }: Pick<KeyLike, 'key' | 'code'>): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    // Letters follow the keyboard layout (the key printed "A" on AZERTY), like
    // Windows hotkeys do; anything else (Cyrillic, Option-modified) uses the position.
    return /^[a-z]$/i.test(key) ? key.toUpperCase() : code.slice(3);
  }
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  return CODE_NAMES[code] ?? null;
}

/**
 * Reads one keydown while recording. Ctrl (Cmd on a Mac) is written as
 * CommandOrControl, like the defaults; the Windows key is Super.
 */
export function readShortcut(event: KeyLike, platform: string | null): RecordedKeys {
  if (MODIFIER_KEYS.has(event.key)) return { type: 'modifiers' };
  const anyModifier = event.ctrlKey || event.altKey || event.metaKey || event.shiftKey;
  if (event.key === 'Escape' && !anyModifier) return { type: 'cancel' };
  if ((event.key === 'Backspace' || event.key === 'Delete') && !anyModifier) return { type: 'clear' };
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return { type: 'tab' };
  const key = keyName(event);
  if (!key) return { type: 'invalid' };
  const mac = platform === 'darwin';
  const modifiers: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) modifiers.push('CommandOrControl');
  if (mac && event.ctrlKey) modifiers.push('Control');
  if (!mac && event.metaKey) modifiers.push('Super');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  // Shift alone would take capital letters from every app.
  if (!STANDALONE.test(key) && !modifiers.some((modifier) => modifier !== 'Shift')) return { type: 'invalid' };
  return { type: 'accelerator', accelerator: [...modifiers, key].join('+') };
}

/** The modifiers held during a keydown/keyup, as accelerator names (for the live preview while recording). */
export function heldModifiers(event: Pick<KeyLike, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>, platform: string | null): ShortcutPart[] {
  const mac = platform === 'darwin';
  const names: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) names.push('CommandOrControl');
  if (mac && event.ctrlKey) names.push('Control');
  if (!mac && event.metaKey) names.push('Super');
  if (event.altKey) names.push('Alt');
  if (event.shiftKey) names.push('Shift');
  return names.map((name) => ({ kind: 'modifier', name }));
}

const MODIFIER_ALIASES: Record<string, string> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  super: 'Super',
  meta: 'Super',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Control', 'Super', 'Alt', 'Shift'];

export type ShortcutPart = { kind: 'modifier' | 'key'; name: string };

/** "Shift+CmdOrCtrl+k" → [CommandOrControl, Shift, K], modifiers first in a fixed order; [] for ''. */
export function shortcutParts(accelerator: string): ShortcutPart[] {
  if (!accelerator) return [];
  const tokens = accelerator.split('+').map((token) => token.trim()).filter(Boolean);
  const key = tokens.pop();
  if (!key) return [];
  const modifiers = tokens.map((token) => MODIFIER_ALIASES[token.toLowerCase()] ?? token);
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [
    ...modifiers.map((name) => ({ kind: 'modifier' as const, name })),
    { kind: 'key', name: key.length === 1 ? key.toUpperCase() : key },
  ];
}

/** Whether two accelerators press the same keys on `platform` (CommandOrControl is Cmd on a Mac, Ctrl elsewhere). */
export function sameShortcut(a: string, b: string, platform: string | null): boolean {
  if (!a || !b) return false;
  const mac = platform === 'darwin';
  const resolve = (accelerator: string) => {
    const parts = shortcutParts(accelerator);
    const modifiers = parts
      .filter((part) => part.kind === 'modifier')
      .map(({ name }) => {
        if (name === 'CommandOrControl') return mac ? 'Command' : 'Control';
        if (name === 'Super' && mac) return 'Command';
        return name;
      });
    const key = parts.find((part) => part.kind === 'key')?.name.toLowerCase() ?? '';
    return [...new Set(modifiers)].sort().join('+') + `+${key === 'return' ? 'enter' : key === 'esc' ? 'escape' : key}`;
  };
  return resolve(a) === resolve(b);
}

/**
 * The answer window's fixed shortcuts (desktop/src/policy.ts
 * answerWindowShortcuts): Ctrl+Alt, or Ctrl+Cmd on a Mac, with the arrows
 * to move, plus Shift to resize, and Home to put it back.
 */
export function answerWindowModifiers(platform: string | null): string[] {
  return platform === 'darwin' ? ['Control', 'Command'] : ['Control', 'Alt'];
}

/** Whether an accelerator is one of the answer window's fixed shortcuts. */
export function isAnswerWindowShortcut(accelerator: string, platform: string | null): boolean {
  const base = answerWindowModifiers(platform).join('+');
  const fixed = ['Left', 'Right', 'Up', 'Down'].flatMap((arrow) => [`${base}+${arrow}`, `${base}+Shift+${arrow}`]);
  fixed.push(`${base}+Home`);
  return fixed.some((shortcut) => sameShortcut(shortcut, accelerator, platform));
}
