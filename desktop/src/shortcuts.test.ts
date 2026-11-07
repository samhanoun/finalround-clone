import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reservedAccelerators, DEFAULT_SHORTCUTS } from './policy';
import { reconcileShortcuts, registerAll, unregisterAll, type ShortcutRegistry, type Shortcuts } from './shortcuts';
import { sameAccelerator } from './accelerator';

/** A stand-in for Electron's globalShortcut: `heldElsewhere` are owned by other apps. */
function fakeRegistry(heldElsewhere: string[] = []) {
  const ours = new Map<string, string>();
  const registry: ShortcutRegistry & { ours: Map<string, string> } = {
    ours,
    register(accelerator, command) {
      if (accelerator === 'Control+Alt+Insert') throw new TypeError('conversion failure');
      if (heldElsewhere.some((held) => sameAccelerator(held, accelerator, 'win32'))) return false;
      if (ours.has(accelerator)) return false;
      ours.set(accelerator, command);
      return true;
    },
    unregister(accelerator) {
      ours.delete(accelerator);
    },
  };
  return registry;
}

const options = { reserved: reservedAccelerators('win32'), platform: 'win32' };
const defaults = (): Shortcuts => ({ ...DEFAULT_SHORTCUTS });

function start(heldElsewhere: string[] = []) {
  const registry = fakeRegistry(heldElsewhere);
  const inactive = registerAll(defaults(), registry);
  return { registry, inactive };
}

test('registerAll reports the shortcuts another app holds', () => {
  const { registry, inactive } = start(['Control+Shift+S']);
  assert.deepEqual([...inactive], ['solve-screen']);
  assert.deepEqual([...registry.ours.values()].sort(), ['answer-now', 'toggle-answers']);
  unregisterAll(defaults(), registry);
  assert.equal(registry.ours.size, 0);
});

test('a free shortcut replaces the old one', () => {
  const { registry } = start();
  const result = reconcileShortcuts(defaults(), { 'answer-now': 'ctrl+alt+j' }, registry, options);
  assert.deepEqual(result.errors, {});
  assert.equal(result.shortcuts['answer-now'], 'Control+Alt+J');
  assert.equal(registry.ours.get('Control+Alt+J'), 'answer-now');
  assert.equal(registry.ours.has('CommandOrControl+Shift+A'), false);
});

test('a shortcut another app holds is refused as taken and the old one stays registered', () => {
  const { registry } = start(['Control+Alt+J']);
  const result = reconcileShortcuts(defaults(), { 'answer-now': 'Control+Alt+J' }, registry, options);
  assert.deepEqual(result.errors, { 'answer-now': 'taken' });
  assert.equal(result.shortcuts['answer-now'], 'CommandOrControl+Shift+A');
  assert.equal(registry.ours.get('CommandOrControl+Shift+A'), 'answer-now');
});

test('malformed or bare-key shortcuts are invalid', () => {
  const { registry } = start();
  const result = reconcileShortcuts(
    defaults(),
    { 'answer-now': 'Shift+Q', 'solve-screen': 'Control+Bogus+', 'toggle-answers': 42 },
    registry,
    options,
  );
  assert.deepEqual(result.errors, { 'answer-now': 'invalid', 'solve-screen': 'invalid', 'toggle-answers': 'invalid' });
  assert.deepEqual(result.shortcuts, defaults());
});

test('an accelerator Electron rejects is reported as invalid', () => {
  const { registry } = start();
  // Passes the grammar, but the fake throws as Electron does for an accelerator it can't convert.
  const result = reconcileShortcuts(defaults(), { 'answer-now': 'Control+Alt+Insert' }, registry, options);
  assert.equal(result.errors['answer-now'], 'invalid');
});

test('collisions with another command or a fixed answer-window shortcut are taken', () => {
  const { registry } = start();
  const result = reconcileShortcuts(defaults(), { 'answer-now': 'Ctrl+Shift+S', 'solve-screen': 'Control+Alt+Left' }, registry, options);
  assert.deepEqual(result.errors, { 'answer-now': 'taken', 'solve-screen': 'taken' });
  assert.deepEqual(result.shortcuts, defaults());
});

test('two commands can trade shortcuts in one change', () => {
  const { registry } = start();
  const result = reconcileShortcuts(
    defaults(),
    { 'answer-now': 'CommandOrControl+Shift+S', 'solve-screen': 'CommandOrControl+Shift+A' },
    registry,
    options,
  );
  assert.deepEqual(result.errors, {});
  assert.equal(registry.ours.get('CommandOrControl+Shift+S'), 'answer-now');
  assert.equal(registry.ours.get('CommandOrControl+Shift+A'), 'solve-screen');
});

test('an empty string clears a shortcut', () => {
  const { registry } = start();
  const result = reconcileShortcuts(defaults(), { 'toggle-answers': '' }, registry, options);
  assert.equal(result.shortcuts['toggle-answers'], '');
  assert.equal(registry.ours.has('CommandOrControl+Shift+H'), false);
});

test('asking again for a shortcut that is unregistered retries it', () => {
  const held = ['Control+Shift+S'];
  const { registry, inactive } = start(held);
  const stillHeld = reconcileShortcuts(defaults(), { 'solve-screen': 'CommandOrControl+Shift+S' }, registry, { ...options, inactive });
  assert.deepEqual(stillHeld.errors, { 'solve-screen': 'taken' });
  assert.deepEqual([...stillHeld.inactive], ['solve-screen']);

  held.length = 0; // the other app let go
  const freed = reconcileShortcuts(defaults(), { 'solve-screen': 'CommandOrControl+Shift+S' }, registry, { ...options, inactive: stillHeld.inactive });
  assert.deepEqual(freed.errors, {});
  assert.equal(freed.inactive.size, 0);
  assert.equal(registry.ours.get('CommandOrControl+Shift+S'), 'solve-screen');
});

test('an unchanged shortcut is left alone', () => {
  const { registry } = start();
  const result = reconcileShortcuts(defaults(), { 'answer-now': 'Ctrl+Shift+A' }, registry, options);
  assert.deepEqual(result.errors, {});
  assert.equal(result.shortcuts['answer-now'], 'CommandOrControl+Shift+A');
});
