import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from './policy';

// The compiled preload, next to this compiled test in dist/.
const preload = readFileSync(path.join(__dirname, 'preload.js'), 'utf8');

test('the preload uses exactly the IPC channels main handles', () => {
  for (const channel of Object.values(IPC_CHANNELS)) assert.ok(preload.includes(`'${channel}'`), channel);
  const used = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(used, Object.values(IPC_CHANNELS).sort());
});

test('the preload is self-contained and exposes no ipcRenderer to the page', () => {
  // A sandboxed preload can only require electron.
  const requires = [...preload.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(requires, ['electron']);
  assert.equal((preload.match(/exposeInMainWorld/g) ?? []).length, 1);
  assert.doesNotMatch(preload, /ipcRenderer\s*[,}]/, 'ipcRenderer must not be handed to the page');
  assert.doesNotMatch(preload, /\.send\(|\.sendSync\(|\.on\(/);
});
