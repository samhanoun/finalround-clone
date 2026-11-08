import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  defaultSettings,
  JsonStore,
  normalizeSettings,
  normalizeWindowState,
  parseSettingsPatch,
  readJsonFile,
  writeJsonAtomic,
} from './settings';

test('defaults: main display, Ctrl+Shift+A/S/H, meeting detection on, close to tray on', () => {
  assert.deepEqual(defaultSettings(), {
    captureDisplayId: null,
    shortcuts: {
      'answer-now': 'CommandOrControl+Shift+A',
      'solve-screen': 'CommandOrControl+Shift+S',
      'toggle-answers': 'CommandOrControl+Shift+H',
    },
    meetingDetection: true,
    closeToTray: true,
  });
});

test('normalizeSettings keeps valid values and falls back to defaults for the rest', () => {
  assert.deepEqual(normalizeSettings(undefined), defaultSettings());
  assert.deepEqual(normalizeSettings('nonsense'), defaultSettings());
  const settings = normalizeSettings({
    captureDisplayId: '2528732444',
    shortcuts: { 'answer-now': 'ctrl+alt+j', 'solve-screen': 'Shift+S', 'toggle-answers': '' },
    meetingDetection: false,
    closeToTray: 'yes',
    extra: 'dropped',
  });
  assert.deepEqual(settings, {
    captureDisplayId: '2528732444',
    shortcuts: { 'answer-now': 'Control+Alt+J', 'solve-screen': 'CommandOrControl+Shift+S', 'toggle-answers': '' },
    meetingDetection: false,
    closeToTray: true,
  });
  assert.equal(normalizeSettings({ captureDisplayId: '../../etc' }).captureDisplayId, null);
  assert.equal(normalizeSettings({ captureDisplayId: 7 }).captureDisplayId, null);
});

test('parseSettingsPatch accepts known keys, ignores unknown ones and rejects wrong types', () => {
  assert.deepEqual(parseSettingsPatch({ meetingDetection: false, other: 1 }), { meetingDetection: false });
  assert.deepEqual(parseSettingsPatch({ captureDisplayId: null }), { captureDisplayId: null });
  assert.deepEqual(parseSettingsPatch({ shortcuts: { 'answer-now': 'F9', 'rm -rf': 'x' } }), { shortcuts: { 'answer-now': 'F9' } });
  assert.throws(() => parseSettingsPatch(null), TypeError);
  assert.throws(() => parseSettingsPatch(['x']), TypeError);
  assert.throws(() => parseSettingsPatch({ closeToTray: 'no' }), TypeError);
  assert.throws(() => parseSettingsPatch({ captureDisplayId: 12 }), TypeError);
  assert.throws(() => parseSettingsPatch({ captureDisplayId: 'a b' }), TypeError);
  assert.throws(() => parseSettingsPatch({ shortcuts: 'Ctrl+A' }), TypeError);
});

test('normalizeWindowState keeps a sane answer-window rect, a known locale and the tray notice flag', () => {
  assert.deepEqual(normalizeWindowState(undefined), { answerWindow: null, locale: null, trayNoticeShown: false });
  assert.deepEqual(
    normalizeWindowState({ answerWindow: { x: 10.4, y: -20, width: 420, height: 620 }, locale: 'de', trayNoticeShown: true }),
    { answerWindow: { x: 10, y: -20, width: 420, height: 620 }, locale: 'de', trayNoticeShown: true },
  );
  assert.equal(normalizeWindowState({ answerWindow: { x: 0, y: 0, width: -5, height: 10 } }).answerWindow, null);
  assert.equal(normalizeWindowState({ answerWindow: { x: 'a', y: 0, width: 5, height: 10 } }).answerWindow, null);
  assert.equal(normalizeWindowState({ locale: 'xx' }).locale, null);
});

test('writeJsonAtomic replaces the file in one step and leaves no temporary files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'apex-settings-'));
  try {
    const file = path.join(dir, 'nested', 'settings.json');
    await writeJsonAtomic(file, { a: 1 });
    await writeJsonAtomic(file, { a: 2 });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { a: 2 });
    assert.deepEqual(await readdir(path.dirname(file)), ['settings.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('JsonStore reads broken files as defaults and keeps the last of several quick saves', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'apex-settings-'));
  try {
    const file = path.join(dir, 'settings.json');
    await writeFile(file, '{ not json');
    assert.equal(await readJsonFile(file), undefined);
    const store = new JsonStore(file, normalizeSettings);
    assert.deepEqual(await store.load(), defaultSettings());

    const saves = [true, false, true, false].map((closeToTray) => store.save({ ...defaultSettings(), closeToTray }));
    await Promise.all(saves);
    assert.equal((await store.load()).closeToTray, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
