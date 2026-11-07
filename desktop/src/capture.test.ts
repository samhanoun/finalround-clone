import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDisplays, effectiveDisplayId, pickScreenSource } from './capture';

const DISPLAYS = [
  { id: 2528732444, label: 'DELL U2720Q', size: { width: 2560, height: 1440 }, scaleFactor: 1.5 },
  { id: 1, label: '', size: { width: 1920, height: 1080 }, scaleFactor: 1 },
];

test('describeDisplays: physical size, the monitor name or a numbered fallback, and the main display', () => {
  assert.deepEqual(describeDisplays(DISPLAYS, 1, (n) => `Display ${n}`), [
    { id: '2528732444', label: 'DELL U2720Q', primary: false, width: 3840, height: 2160 },
    { id: '1', label: 'Display 2', primary: true, width: 1920, height: 1080 },
  ]);
});

test('effectiveDisplayId falls back to the main display when the chosen one is gone', () => {
  const displays = [{ id: '2528732444' }, { id: '1' }];
  assert.equal(effectiveDisplayId('2528732444', displays, '1'), '2528732444');
  assert.equal(effectiveDisplayId('999', displays, '1'), '1');
  assert.equal(effectiveDisplayId(null, displays, '1'), '1');
});

test('pickScreenSource: the chosen display, else the main one, else the first screen', () => {
  const sources = [
    { id: 'screen:0:0', display_id: '1' },
    { id: 'screen:1:0', display_id: '2528732444' },
  ];
  assert.equal(pickScreenSource(sources, '2528732444', '1')?.id, 'screen:1:0');
  assert.equal(pickScreenSource(sources, '999', '1')?.id, 'screen:0:0');
  assert.equal(pickScreenSource(sources, null, '2528732444')?.id, 'screen:1:0');
  assert.equal(pickScreenSource([{ id: 'screen:7:0', display_id: '' }], '1', '1')?.id, 'screen:7:0');
  assert.equal(pickScreenSource([], null, '1'), undefined);
});
