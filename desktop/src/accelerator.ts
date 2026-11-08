/**
 * Electron accelerators ("CommandOrControl+Shift+A"): parsing, a canonical
 * spelling, and the rules for a global shortcut. Kept free of Electron so it
 * can be unit tested; main.ts still treats a throw from
 * `globalShortcut.register` as an invalid accelerator.
 */

/** Modifiers in the order they're written back. */
const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Control', 'Super', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_ALIASES: Record<string, Modifier> = {
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

const NAMED_KEYS = [
  'Plus',
  'Space',
  'Tab',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'Backspace',
  'Delete',
  'Insert',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'VolumeUp',
  'VolumeDown',
  'VolumeMute',
  'MediaNextTrack',
  'MediaPreviousTrack',
  'MediaStop',
  'MediaPlayPause',
  'PrintScreen',
  'num0',
  'num1',
  'num2',
  'num3',
  'num4',
  'num5',
  'num6',
  'num7',
  'num8',
  'num9',
  'numdec',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
] as const;

const KEY_ALIASES: Record<string, string> = {
  ...Object.fromEntries(NAMED_KEYS.map((key) => [key.toLowerCase(), key])),
  return: 'Enter',
  esc: 'Escape',
};

/** Unshifted punctuation; "+" is spelled Plus because it separates the parts. */
const PUNCTUATION = new Set(['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/']);

/** Keys that make sense on their own as a global shortcut (no modifier needed). */
const STANDALONE_KEY = /^(F([1-9]|1\d|2[0-4])|Media(NextTrack|PreviousTrack|Stop|PlayPause)|Volume(Up|Down|Mute))$/;

export type ParsedAccelerator = { modifiers: Modifier[]; key: string };

function canonicalKey(token: string): string | null {
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]$/.test(token)) return token;
  const fn = /^f([1-9]|1\d|2[0-4])$/i.exec(token);
  if (fn) return `F${fn[1]}`;
  if (PUNCTUATION.has(token)) return token;
  return KEY_ALIASES[token.toLowerCase()] ?? null;
}

/** "ctrl + shift + a" → { modifiers: ['Control', 'Shift'], key: 'A' }; null when it isn't one key plus modifiers. */
export function parseAccelerator(raw: string): ParsedAccelerator | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 100) return null;
  const tokens = raw.split('+').map((token) => token.trim());
  if (tokens.some((token) => token.length === 0)) return null;
  const keyToken = tokens.pop() as string;
  const key = canonicalKey(keyToken);
  if (!key) return null;
  const modifiers = new Set<Modifier>();
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  return { modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key };
}

/** The canonical spelling ("Ctrl+shift+a" → "Control+Shift+A"), or null if it isn't an accelerator. */
export function normalizeAccelerator(raw: string): string | null {
  const parsed = parseAccelerator(raw);
  return parsed ? [...parsed.modifiers, parsed.key].join('+') : null;
}

/**
 * Whether an accelerator may be a global shortcut: it needs Ctrl, Alt, Cmd or
 * the Windows key (Shift alone would swallow capital letters everywhere),
 * except for function and media keys, which may stand alone.
 */
export function isUsableGlobalShortcut(raw: string): boolean {
  const parsed = parseAccelerator(raw);
  if (!parsed) return false;
  if (STANDALONE_KEY.test(parsed.key)) return true;
  return parsed.modifiers.some((modifier) => modifier !== 'Shift');
}

/** The keys an accelerator presses on this platform (CommandOrControl is Cmd on a Mac, Ctrl elsewhere). */
function resolvedKeys(raw: string, platform: string): string | null {
  const parsed = parseAccelerator(raw);
  if (!parsed) return null;
  const mac = platform === 'darwin';
  const keys = new Set(
    parsed.modifiers.map((modifier) => {
      if (modifier === 'CommandOrControl') return mac ? 'Command' : 'Control';
      // Electron maps Super to the Command key on a Mac.
      if (modifier === 'Super' && mac) return 'Command';
      return modifier;
    }),
  );
  return [...[...keys].sort(), parsed.key].join('+');
}

/** Whether two accelerators press the same keys on `platform`. */
export function sameAccelerator(a: string, b: string, platform: string): boolean {
  if (!a || !b) return false;
  const left = resolvedKeys(a, platform);
  return left !== null && left === resolvedKeys(b, platform);
}
