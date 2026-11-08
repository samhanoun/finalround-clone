import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsableGlobalShortcut, normalizeAccelerator, parseAccelerator, sameAccelerator } from './accelerator';

test('normalizeAccelerator spells modifiers and keys one way', () => {
  assert.equal(normalizeAccelerator('ctrl+shift+a'), 'Control+Shift+A');
  assert.equal(normalizeAccelerator('Shift+CmdOrCtrl+K'), 'CommandOrControl+Shift+K');
  assert.equal(normalizeAccelerator('Alt + F4'), 'Alt+F4');
  assert.equal(normalizeAccelerator('Control+Alt+Return'), 'Control+Alt+Enter');
  assert.equal(normalizeAccelerator('Option+esc'), 'Alt+Escape');
  assert.equal(normalizeAccelerator('Meta+pageup'), 'Super+PageUp');
  assert.equal(normalizeAccelerator('CommandOrControl+Plus'), 'CommandOrControl+Plus');
  assert.equal(normalizeAccelerator('Control+num5'), 'Control+num5');
  assert.equal(normalizeAccelerator('Control+;'), 'Control+;');
});

test('normalizeAccelerator refuses what is not one key plus modifiers', () => {
  for (const bad of ['', 'Control+', '+A', 'Control++', 'Control+Shift', 'Control+AB', 'Hyper+A', 'Control+Control+A', 'Control+F25', 'Control+é', 'A'.repeat(101)]) {
    assert.equal(normalizeAccelerator(bad), null, bad);
  }
  assert.equal(parseAccelerator(42 as unknown as string), null);
});

test('isUsableGlobalShortcut needs Ctrl, Alt, Cmd or Win, except function and media keys', () => {
  assert.equal(isUsableGlobalShortcut('CommandOrControl+Shift+A'), true);
  assert.equal(isUsableGlobalShortcut('Alt+1'), true);
  assert.equal(isUsableGlobalShortcut('Super+K'), true);
  assert.equal(isUsableGlobalShortcut('F9'), true);
  assert.equal(isUsableGlobalShortcut('Shift+F9'), true);
  assert.equal(isUsableGlobalShortcut('MediaPlayPause'), true);
  assert.equal(isUsableGlobalShortcut('A'), false);
  assert.equal(isUsableGlobalShortcut('Shift+A'), false);
  assert.equal(isUsableGlobalShortcut('Space'), false);
  assert.equal(isUsableGlobalShortcut('not a shortcut'), false);
});

test('sameAccelerator compares the keys pressed on each platform', () => {
  assert.equal(sameAccelerator('CommandOrControl+Shift+A', 'Ctrl+Shift+A', 'win32'), true);
  assert.equal(sameAccelerator('CommandOrControl+Shift+A', 'Ctrl+Shift+A', 'darwin'), false);
  assert.equal(sameAccelerator('CommandOrControl+Shift+A', 'Command+Shift+A', 'darwin'), true);
  assert.equal(sameAccelerator('Shift+Alt+K', 'Alt+Shift+k', 'win32'), true);
  assert.equal(sameAccelerator('Control+Alt+Left', 'Control+Alt+Right', 'win32'), false);
  assert.equal(sameAccelerator('', '', 'win32'), false);
  assert.equal(sameAccelerator('junk', 'junk', 'win32'), false);
});
