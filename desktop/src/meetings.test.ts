import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMeetingApps, meetingAppFor, MeetingTracker, parseMicrophoneUsers, type MicrophoneUser } from './meetings';

const ROOT = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

/** `reg query <key> /s` output as Windows prints it (CRLF, four-space columns). */
function regOutput(blocks: Array<[string, Array<[string, string, string]>]>): string {
  const lines = [''];
  for (const [key, values] of blocks) {
    lines.push(key ? `${ROOT}\\${key}` : ROOT);
    for (const [name, type, data] of values) lines.push(`    ${name}    ${type}    ${data}`);
    lines.push('');
  }
  return lines.join('\r\n');
}

const used = (start: string, stop: string): Array<[string, string, string]> => [
  ['LastUsedTimeStart', 'REG_QWORD', start],
  ['LastUserAnnotatedLabel', 'REG_DWORD', '0x2'],
  ['LastUsedTimeStop', 'REG_QWORD', stop],
  ['PersistedInDatabase', 'REG_DWORD', '0x1'],
];

const SAMPLE = regOutput([
  ['', [['Value', 'REG_SZ', 'Allow'], ['LastSetTime', 'REG_QWORD', '0x1db41fa31b8fa60']]],
  // A Store app that never used the microphone.
  ['Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe', [['Value', 'REG_SZ', 'Prompt'], ['LastSetTime', 'REG_QWORD', '0x1db41eccbc6d821']]],
  // New Teams (packaged), in a call right now.
  ['MSTeams_8wekyb3d8bbwe', [['Value', 'REG_SZ', 'Allow'], ...used('0x1dd4c035b35bab9', '0x0')]],
  // Slack from the Store, used earlier and stopped.
  ['91750D7E.Slack_8she8kybcnzg4', [['Value', 'REG_SZ', 'Allow'], ...used('0x1dccda39d551493', '0x1dccda3a0000000')]],
  ['NonPackaged', [['Value', 'REG_SZ', 'Allow'], ['LastSetTime', 'REG_QWORD', '0x1db41fa8c087b5e']]],
  // Zoom's screen-share host and Zoom itself, live.
  ['NonPackaged\\C:#Users#alex#AppData#Roaming#Zoom#bin#CptHost.exe', used('0x1dd6dfbe744104b', '0x0')],
  ['NonPackaged\\C:#Users#alex#AppData#Roaming#Zoom#bin#Zoom.exe', used('0x1dd6dfbe744104b', '0x0')],
  // A browser on a call: left to the web app.
  ['NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe', used('0x1dd6dfbe744104b', '0x0')],
  // Apex Round itself while it listens.
  ['NonPackaged\\C:#Users#alex#AppData#Local#Programs#Apex Round#Apex Round.exe', used('0x1dd6dfbe744104b', '0x0')],
  // A game whose name contains "Apex": nothing to do with us.
  ['NonPackaged\\C:#Program Files#EA Games#Apex#r5apex_dx12.exe', used('0x1db80bb6f0a71c0', '0x0')],
  // Webex, finished.
  ['NonPackaged\\C:#Program Files#Cisco Spark#CiscoCollabHost.exe', used('0x1dd6dfbe744104b', '0x1dd6dfbe844104b')],
  // Started but never stamped as used: not active.
  ['NonPackaged\\C:#Tools#recorder.exe', used('0x0', '0x0')],
]);

const OWN_EXE = 'C:\\Users\\alex\\AppData\\Local\\Programs\\Apex Round\\Apex Round.exe';

test('parseMicrophoneUsers reads packaged and desktop apps with their state', () => {
  const users = parseMicrophoneUsers(SAMPLE);
  const byId = new Map(users.map((user) => [user.id, user]));
  assert.equal(users.length, 9);
  assert.deepEqual(byId.get('MSTeams_8wekyb3d8bbwe'), {
    kind: 'packaged',
    id: 'MSTeams_8wekyb3d8bbwe',
    name: 'MSTeams_8wekyb3d8bbwe',
    active: true,
  });
  assert.deepEqual(byId.get('C:\\Users\\alex\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe'), {
    kind: 'desktop',
    id: 'C:\\Users\\alex\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe',
    name: 'zoom.exe',
    active: true,
  });
  assert.equal(byId.get('91750D7E.Slack_8she8kybcnzg4')?.active, false);
  assert.equal(byId.get('C:\\Program Files\\Cisco Spark\\CiscoCollabHost.exe')?.active, false);
  assert.equal(byId.get('C:\\Tools\\recorder.exe')?.active, false);
  // The root, the NonPackaged folder and apps without usage times aren't apps in use.
  assert.equal(byId.has('NonPackaged'), false);
  assert.equal(byId.has('Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe'), false);
});

test('parseMicrophoneUsers copes with LF endings, empty output and errors', () => {
  assert.equal(parseMicrophoneUsers(SAMPLE.replace(/\r\n/g, '\n')).length, 9);
  assert.deepEqual(parseMicrophoneUsers(''), []);
  assert.deepEqual(parseMicrophoneUsers('ERROR: The system was unable to find the specified registry key or value.'), []);
  const garbled = regOutput([['NonPackaged\\C:#x#Zoom.exe', [['LastUsedTimeStart', 'REG_QWORD', 'zzz'], ['LastUsedTimeStop', 'REG_QWORD', '0x0']]]]);
  assert.deepEqual(parseMicrophoneUsers(garbled), []);
});

test('meeting apps are matched by executable or package; browsers and Apex Round are ignored', () => {
  const desktop = (name: string, id = `C:\\Apps\\${name}`): MicrophoneUser => ({ kind: 'desktop', id, name: name.toLowerCase(), active: true });
  const packaged = (id: string): MicrophoneUser => ({ kind: 'packaged', id, name: id, active: true });
  assert.equal(meetingAppFor(desktop('Zoom.exe')), 'Zoom');
  assert.equal(meetingAppFor(desktop('CptHost.exe')), 'Zoom');
  assert.equal(meetingAppFor(desktop('Teams.exe')), 'Microsoft Teams');
  assert.equal(meetingAppFor(desktop('ms-teams.exe')), 'Microsoft Teams');
  assert.equal(meetingAppFor(packaged('MSTeams_8wekyb3d8bbwe')), 'Microsoft Teams');
  assert.equal(meetingAppFor(packaged('MicrosoftTeams_8wekyb3d8bbwe')), 'Microsoft Teams');
  assert.equal(meetingAppFor(desktop('CiscoCollabHost.exe')), 'Webex');
  assert.equal(meetingAppFor(desktop('atmgr.exe')), 'Webex');
  assert.equal(meetingAppFor(desktop('slack.exe')), 'Slack');
  assert.equal(meetingAppFor(packaged('91750D7E.Slack_8she8kybcnzg4')), 'Slack');
  assert.equal(meetingAppFor(desktop('chrome.exe')), null);
  assert.equal(meetingAppFor(desktop('msedge.exe')), null);
  assert.equal(meetingAppFor(desktop('Discord.exe')), null);
  assert.equal(meetingAppFor(packaged('5319275A.WhatsAppDesktop_cv1g1gvanyjgm')), null);
  assert.equal(meetingAppFor(desktop('Zoom.exe', 'C:\\Apex\\Zoom.exe'), 'c:\\apex\\zoom.exe'), null);
});

test('activeMeetingApps lists each live meeting app once', () => {
  assert.deepEqual([...activeMeetingApps(parseMicrophoneUsers(SAMPLE), OWN_EXE)].sort(), ['Microsoft Teams', 'Zoom']);
});

test('MeetingTracker reports a start at once and an end after two quiet polls', () => {
  const tracker = new MeetingTracker(2);
  assert.deepEqual(tracker.update(new Set(['Zoom'])), [{ state: 'started', app: 'Zoom' }]);
  assert.deepEqual(tracker.update(new Set(['Zoom'])), []);
  // Zoom reopens its microphone (a headset switch): one quiet poll isn't an end.
  assert.deepEqual(tracker.update(new Set()), []);
  assert.deepEqual(tracker.update(new Set(['Zoom'])), []);
  assert.deepEqual(tracker.update(new Set()), []);
  assert.deepEqual(tracker.update(new Set()), [{ state: 'ended', app: 'Zoom' }]);
  assert.deepEqual(tracker.update(new Set()), []);
  assert.deepEqual(tracker.liveApps, []);
});

test('MeetingTracker follows several apps, and reset forgets them without ending anything', () => {
  const tracker = new MeetingTracker(1);
  assert.deepEqual(tracker.update(new Set(['Zoom', 'Slack'])), [
    { state: 'started', app: 'Zoom' },
    { state: 'started', app: 'Slack' },
  ]);
  assert.deepEqual(tracker.update(new Set(['Zoom'])), [{ state: 'ended', app: 'Slack' }]);
  tracker.reset();
  assert.deepEqual(tracker.liveApps, []);
  assert.deepEqual(tracker.update(new Set(['Zoom'])), [{ state: 'started', app: 'Zoom' }]);
});
