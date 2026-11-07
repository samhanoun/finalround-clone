import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItem, MenuItemConstructorOptions } from 'electron';
import { DEFAULT_SHORTCUTS, type DesktopCommand } from './policy';
import { displayLabel, trayMenuTemplate, type TrayActions, type TrayState } from './trayMenu';

const DISPLAYS = [
  { id: '1', label: 'Display 1', primary: true, width: 1920, height: 1080 },
  { id: '2', label: 'DELL U2720Q', primary: false, width: 3840, height: 2160 },
];

function setup(state: Partial<TrayState> = {}) {
  const calls: string[] = [];
  const actions: TrayActions = {
    open: () => calls.push('open'),
    command: (command: DesktopCommand) => calls.push(`command:${command}`),
    chooseDisplay: (id) => calls.push(`display:${id}`),
    setMeetingDetection: (on) => calls.push(`meetings:${on}`),
    openShortcuts: () => calls.push('shortcuts'),
    quit: () => calls.push('quit'),
  };
  const template = trayMenuTemplate(
    {
      locale: 'en',
      onLivePage: true,
      answerWindowOpen: false,
      displays: DISPLAYS,
      captureDisplayId: '2',
      meetingDetection: true,
      shortcuts: DEFAULT_SHORTCUTS,
      ...state,
    },
    actions,
  );
  const byLabel = (label: string) => template.find((item) => item.label === label) as MenuItemConstructorOptions;
  const click = (item: MenuItemConstructorOptions, checked = false) =>
    (item.click as (menuItem: MenuItem) => void)({ checked } as MenuItem);
  return { template, byLabel, click, calls };
}

test('the tray menu lists the actions in order, in the page language', () => {
  const { template } = setup();
  assert.deepEqual(
    template.map((item) => (item.type === 'separator' ? '—' : item.label)),
    ['Open Apex Round', '—', 'Answer now', 'Solve screen', 'Show or hide answer window', '—', 'Screen to capture', 'Detect meetings', 'Shortcuts…', '—', 'Quit'],
  );
  const spanish = setup({ locale: 'es' }).template;
  assert.equal(spanish[0].label, 'Abrir Apex Round');
  assert.equal(spanish.at(-1)?.label, 'Salir');
});

test('commands are enabled on the live page only, and show their shortcut', () => {
  const live = setup();
  assert.equal(live.byLabel('Answer now').enabled, true);
  assert.equal(live.byLabel('Answer now').accelerator, 'CommandOrControl+Shift+A');
  assert.equal(live.byLabel('Answer now').registerAccelerator, false);
  const elsewhere = setup({ onLivePage: false });
  assert.equal(elsewhere.byLabel('Answer now').enabled, false);
  assert.equal(elsewhere.byLabel('Show or hide answer window').enabled, false);
  // An open answer window can always be put away.
  assert.equal(setup({ onLivePage: false, answerWindowOpen: true }).byLabel('Show or hide answer window').enabled, true);
  // A cleared shortcut shows nothing.
  const cleared = setup({ shortcuts: { ...DEFAULT_SHORTCUTS, 'solve-screen': '' } });
  assert.equal(cleared.byLabel('Solve screen').accelerator, undefined);
});

test('the capture submenu is a radio list of displays with the capture display checked', () => {
  const { byLabel, click, calls } = setup();
  const submenu = byLabel('Screen to capture').submenu as MenuItemConstructorOptions[];
  assert.deepEqual(
    submenu.map((item) => [item.label, item.type, item.checked]),
    [
      ['Display 1 (main), 1920 × 1080', 'radio', false],
      ['DELL U2720Q, 3840 × 2160', 'radio', true],
    ],
  );
  click(submenu[0]);
  assert.deepEqual(calls, ['display:1']);
});

test('clicks reach the actions; meeting detection is a checkbox, hidden where it does not exist', () => {
  const { byLabel, click, calls } = setup();
  click(byLabel('Open Apex Round'));
  click(byLabel('Solve screen'));
  click(byLabel('Detect meetings'), false);
  click(byLabel('Shortcuts…'));
  click(byLabel('Quit'));
  assert.deepEqual(calls, ['open', 'command:solve-screen', 'meetings:false', 'shortcuts', 'quit']);
  assert.equal(byLabel('Detect meetings').type, 'checkbox');
  assert.equal(byLabel('Detect meetings').checked, true);
  assert.equal(setup({ meetingDetection: null }).byLabel('Detect meetings'), undefined);
});

test('displayLabel marks the main display in each language', () => {
  assert.equal(displayLabel(DISPLAYS[0], 'de'), 'Display 1 (Hauptbildschirm), 1920 × 1080');
  assert.equal(displayLabel(DISPLAYS[1], 'fr'), 'DELL U2720Q, 3840 × 2160');
});
