import { heldModifiers, isAnswerWindowShortcut, readShortcut, sameShortcut, shortcutParts } from '@/components/desktop/shortcutKeys';

const press = (key: string, code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('readShortcut', () => {
  it('turns a key press into an Electron accelerator', () => {
    expect(readShortcut(press('k', 'KeyK', { ctrlKey: true, shiftKey: true }), 'win32')).toEqual({
      type: 'accelerator',
      accelerator: 'CommandOrControl+Shift+K',
    });
    expect(readShortcut(press('ArrowUp', 'ArrowUp', { altKey: true }), 'win32')).toEqual({ type: 'accelerator', accelerator: 'Alt+Up' });
    expect(readShortcut(press('7', 'Numpad7', { ctrlKey: true }), 'win32')).toEqual({ type: 'accelerator', accelerator: 'CommandOrControl+num7' });
    expect(readShortcut(press('F9', 'F9'), 'win32')).toEqual({ type: 'accelerator', accelerator: 'F9' });
    expect(readShortcut(press('k', 'KeyK', { metaKey: true }), 'win32')).toEqual({ type: 'accelerator', accelerator: 'Super+K' });
  });

  it('uses Cmd as CommandOrControl on a Mac, and Ctrl as Control', () => {
    expect(readShortcut(press('k', 'KeyK', { metaKey: true, shiftKey: true }), 'darwin')).toEqual({
      type: 'accelerator',
      accelerator: 'CommandOrControl+Shift+K',
    });
    expect(readShortcut(press('k', 'KeyK', { ctrlKey: true, metaKey: true }), 'darwin')).toEqual({
      type: 'accelerator',
      accelerator: 'CommandOrControl+Control+K',
    });
  });

  it('follows the layout for letters and the position otherwise', () => {
    // AZERTY: the key printed A sits where QWERTY has Q.
    expect(readShortcut(press('a', 'KeyQ', { ctrlKey: true, altKey: true }), 'win32')).toEqual({ type: 'accelerator', accelerator: 'CommandOrControl+Alt+A' });
    // Cyrillic, or a character from AltGr/Option: back to the physical key.
    expect(readShortcut(press('ф', 'KeyA', { ctrlKey: true }), 'win32')).toEqual({ type: 'accelerator', accelerator: 'CommandOrControl+A' });
    expect(readShortcut(press('å', 'KeyA', { metaKey: true, altKey: true }), 'darwin')).toEqual({ type: 'accelerator', accelerator: 'CommandOrControl+Alt+A' });
    // Digits by position (AZERTY types & without Shift).
    expect(readShortcut(press('&', 'Digit1', { ctrlKey: true }), 'win32')).toEqual({ type: 'accelerator', accelerator: 'CommandOrControl+1' });
  });

  it('waits on modifiers and handles Esc, Backspace, Tab and keys that cannot be shortcuts', () => {
    expect(readShortcut(press('Control', 'ControlLeft', { ctrlKey: true }), 'win32')).toEqual({ type: 'modifiers' });
    expect(readShortcut(press('Escape', 'Escape'), 'win32')).toEqual({ type: 'cancel' });
    expect(readShortcut(press('Backspace', 'Backspace'), 'win32')).toEqual({ type: 'clear' });
    expect(readShortcut(press('Delete', 'Delete'), 'win32')).toEqual({ type: 'clear' });
    expect(readShortcut(press('Tab', 'Tab', { shiftKey: true }), 'win32')).toEqual({ type: 'tab' });
    expect(readShortcut(press('k', 'KeyK'), 'win32')).toEqual({ type: 'invalid' });
    expect(readShortcut(press('K', 'KeyK', { shiftKey: true }), 'win32')).toEqual({ type: 'invalid' });
    expect(readShortcut(press('Unidentified', 'IntlRo', { ctrlKey: true }), 'win32')).toEqual({ type: 'invalid' });
    // With a modifier, Escape and Backspace are ordinary keys.
    expect(readShortcut(press('Escape', 'Escape', { ctrlKey: true, altKey: true }), 'win32')).toEqual({
      type: 'accelerator',
      accelerator: 'CommandOrControl+Alt+Escape',
    });
  });
});

describe('shortcut helpers', () => {
  it('splits an accelerator into keycaps, modifiers first', () => {
    expect(shortcutParts('Shift+CmdOrCtrl+k')).toEqual([
      { kind: 'modifier', name: 'CommandOrControl' },
      { kind: 'modifier', name: 'Shift' },
      { kind: 'key', name: 'K' },
    ]);
    expect(shortcutParts('')).toEqual([]);
  });

  it('compares accelerators by the keys they press on each platform', () => {
    expect(sameShortcut('CommandOrControl+Shift+A', 'Ctrl+Shift+a', 'win32')).toBe(true);
    expect(sameShortcut('CommandOrControl+Shift+A', 'Ctrl+Shift+A', 'darwin')).toBe(false);
    expect(sameShortcut('Control+Alt+Return', 'Ctrl+Alt+Enter', 'win32')).toBe(true);
    expect(sameShortcut('', 'Ctrl+A', 'win32')).toBe(false);
  });

  it('knows the answer window’s fixed shortcuts', () => {
    expect(isAnswerWindowShortcut('CommandOrControl+Alt+Left', 'win32')).toBe(true);
    expect(isAnswerWindowShortcut('Control+Alt+Shift+Down', 'win32')).toBe(true);
    expect(isAnswerWindowShortcut('Control+Alt+Home', 'win32')).toBe(true);
    expect(isAnswerWindowShortcut('Control+Alt+End', 'win32')).toBe(false);
    expect(isAnswerWindowShortcut('CommandOrControl+Control+Left', 'darwin')).toBe(true);
  });

  it('reports the modifiers held while recording', () => {
    expect(heldModifiers({ ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }, 'win32')).toEqual([
      { kind: 'modifier', name: 'CommandOrControl' },
      { kind: 'modifier', name: 'Shift' },
    ]);
  });
});
