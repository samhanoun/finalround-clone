import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingWatcher, type RegQuery } from './meetingWatcher';
import type { MeetingChange } from './meetings';

const ROOT = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const zoom = (stop: string) =>
  [
    '',
    `${ROOT}\\NonPackaged\\C:#Users#alex#AppData#Roaming#Zoom#bin#Zoom.exe`,
    '    LastUsedTimeStart    REG_QWORD    0x1dd6dfbe744104b',
    `    LastUsedTimeStop    REG_QWORD    ${stop}`,
    '',
  ].join('\r\n');

type Reply = { error?: Error & { code?: number | string | null; killed?: boolean }; stdout: string };

/** A reg query that answers from a script, one reply per poll (the last one repeats). */
function scripted(replies: Reply[]): RegQuery {
  let index = 0;
  return (callback) => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    callback(reply.error ?? null, reply.stdout);
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('the watcher reports a meeting starting and, after two quiet polls, ending', async () => {
  const changes: MeetingChange[] = [];
  const failure = Object.assign(new Error('timed out'), { killed: true });
  const watcher = new MeetingWatcher((change) => changes.push(change), {
    ownExecutable: 'C:\\Apex Round\\Apex Round.exe',
    platform: 'win32',
    intervalMs: 5,
    query: scripted([
      { stdout: zoom('0x0') },
      // A timed-out query says nothing: no end.
      { error: failure, stdout: '' },
      { error: failure, stdout: '' },
      { stdout: zoom('0x1dd6dfbe844104b') },
      { stdout: zoom('0x1dd6dfbe844104b') },
    ]),
  });
  watcher.start();
  assert.deepEqual(changes, [{ state: 'started', app: 'Zoom' }]);
  await wait(120);
  watcher.stop();
  assert.deepEqual(changes, [
    { state: 'started', app: 'Zoom' },
    { state: 'ended', app: 'Zoom' },
  ]);
  assert.equal(watcher.running, false);
});

test('a missing registry key means no app is using the microphone', async () => {
  const changes: MeetingChange[] = [];
  const missing = Object.assign(new Error('Command failed'), { code: 1 });
  const watcher = new MeetingWatcher((change) => changes.push(change), {
    ownExecutable: 'x',
    platform: 'win32',
    intervalMs: 5,
    query: scripted([{ stdout: zoom('0x0') }, { error: missing, stdout: '' }]),
  });
  watcher.start();
  await wait(80);
  watcher.stop();
  assert.deepEqual(changes, [
    { state: 'started', app: 'Zoom' },
    { state: 'ended', app: 'Zoom' },
  ]);
});

test('the watcher does nothing outside Windows, and stopping ends nothing', async () => {
  let queries = 0;
  const query: RegQuery = (callback) => {
    queries += 1;
    callback(null, zoom('0x0'));
  };
  const mac = new MeetingWatcher(() => assert.fail('no events on a Mac'), { ownExecutable: 'x', platform: 'darwin', query });
  mac.start();
  assert.equal(mac.running, false);
  assert.equal(queries, 0);

  const changes: MeetingChange[] = [];
  const windows = new MeetingWatcher((change) => changes.push(change), { ownExecutable: 'x', platform: 'win32', intervalMs: 5, query });
  windows.start();
  windows.stop();
  await wait(30);
  assert.deepEqual(changes, [{ state: 'started', app: 'Zoom' }]);
});
