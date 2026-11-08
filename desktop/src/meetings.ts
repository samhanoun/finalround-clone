/**
 * Meeting detection on Windows, without Electron: which apps are using the
 * microphone right now, read from Windows' privacy records
 * (HKCU\…\CapabilityAccessManager\ConsentStore\microphone, the data behind
 * "apps using your microphone"), and which of them are meeting apps.
 *
 * Each app has a subkey: packaged (Store) apps by package family name
 * ("MSTeams_8wekyb3d8bbwe"), desktop apps under NonPackaged by their path
 * with # for \ ("C:#Program Files#Zoom#bin#Zoom.exe"). An app is using the
 * microphone while LastUsedTimeStart is set and LastUsedTimeStop is 0.
 */

export const MICROPHONE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

export type MicrophoneUser = {
  /** "packaged" (Store app) or "desktop" (NonPackaged). */
  kind: 'packaged' | 'desktop';
  /** Package family name, or the executable's full path. */
  id: string;
  /** Lower-case executable name for desktop apps ("zoom.exe"); the package family name otherwise. */
  name: string;
  active: boolean;
};

const VALUE_LINE = /^\s+(\S(?:.*?\S)?)\s{4,}(REG_[A-Z_0-9]+)(?:\s{4,}(.*?))?\s*$/;

function qword(data: string | undefined): bigint | null {
  if (!data) return null;
  try {
    return BigInt(data.trim());
  } catch {
    return null;
  }
}

/**
 * Parses `reg query <MICROPHONE_KEY> /s` output into the apps it lists.
 * Keys without usage times (the root, the NonPackaged folder, apps that
 * never used the microphone) are left out.
 */
export function parseMicrophoneUsers(output: string): MicrophoneUser[] {
  const users: MicrophoneUser[] = [];
  const rootLower = MICROPHONE_KEY.toLowerCase().replace(/^hkcu\\/, '');
  let current: { path: string; values: Map<string, string> } | null = null;

  const flush = () => {
    if (!current) return;
    const start = qword(current.values.get('lastusedtimestart'));
    const stop = qword(current.values.get('lastusedtimestop'));
    const at = current.path.toLowerCase().indexOf(rootLower);
    const relative = at < 0 ? '' : current.path.slice(at + rootLower.length).replace(/^\\/, '');
    current = null;
    if (start === null || stop === null || !relative || relative.toLowerCase() === 'nonpackaged') return;
    const active = start !== 0n && stop === 0n;
    const nonPackaged = /^nonpackaged\\(.+)$/i.exec(relative);
    if (nonPackaged) {
      const exePath = nonPackaged[1].replace(/#/g, '\\');
      const name = exePath.split('\\').pop()?.toLowerCase() ?? '';
      if (name) users.push({ kind: 'desktop', id: exePath, name, active });
    } else if (!relative.includes('\\')) {
      users.push({ kind: 'packaged', id: relative, name: relative, active });
    }
  };

  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      flush();
      current = { path: line.trim(), values: new Map() };
      continue;
    }
    const value = current && VALUE_LINE.exec(line);
    if (current && value) current.values.set(value[1].toLowerCase(), value[3] ?? '');
  }
  flush();
  return users;
}

type MeetingApp = { name: string; executables: string[]; packages: RegExp[] };

/** Meeting apps by executable or package family. Browsers are left out on purpose (the web app covers meetings in a tab). */
export const MEETING_APPS: readonly MeetingApp[] = [
  // CptHost.exe is Zoom's screen-sharing host.
  { name: 'Zoom', executables: ['zoom.exe', 'cpthost.exe'], packages: [/^zoom\./i] },
  {
    name: 'Microsoft Teams',
    executables: ['teams.exe', 'ms-teams.exe', 'msteams.exe'],
    packages: [/^msteams_/i, /^microsoftteams_/i],
  },
  {
    name: 'Webex',
    executables: ['webex.exe', 'ciscocollabhost.exe', 'atmgr.exe', 'webexmta.exe', 'ciscowebexstart.exe'],
    packages: [/^cisco\.?webex/i],
  },
  // Slack only opens the microphone for huddles and calls.
  { name: 'Slack', executables: ['slack.exe'], packages: [/\.slack_/i] },
];

const BROWSERS = new Set([
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'vivaldi.exe',
  'arc.exe',
  'iexplore.exe',
]);

/** The meeting app behind a microphone user, or null (not a meeting app, a browser, or Apex Round itself). */
export function meetingAppFor(user: MicrophoneUser, ownExecutable?: string): string | null {
  if (user.kind === 'desktop') {
    if (ownExecutable && user.id.toLowerCase() === ownExecutable.toLowerCase()) return null;
    if (BROWSERS.has(user.name)) return null;
    return MEETING_APPS.find((app) => app.executables.includes(user.name))?.name ?? null;
  }
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- MEETING_APPS' own short literal patterns, each linear
  return MEETING_APPS.find((app) => app.packages.some((pattern) => pattern.test(user.id)))?.name ?? null;
}

/** Names of the meeting apps using the microphone right now. */
export function activeMeetingApps(users: readonly MicrophoneUser[], ownExecutable?: string): Set<string> {
  const apps = new Set<string>();
  for (const user of users) {
    if (!user.active) continue;
    const app = meetingAppFor(user, ownExecutable);
    if (app) apps.add(app);
  }
  return apps;
}

export type MeetingChange = { state: 'started' | 'ended'; app: string };

/**
 * Turns polls into start and end events. A start is reported at once; an end
 * only after the app has been off the microphone for `endAfter` polls in a
 * row, so a meeting app reopening its device (switching headsets, a test
 * call) doesn't end and restart the meeting.
 */
export class MeetingTracker {
  private readonly live = new Set<string>();
  private readonly missing = new Map<string, number>();

  constructor(private readonly endAfter = 2) {}

  update(active: ReadonlySet<string>): MeetingChange[] {
    const changes: MeetingChange[] = [];
    for (const app of active) {
      this.missing.delete(app);
      if (!this.live.has(app)) {
        this.live.add(app);
        changes.push({ state: 'started', app });
      }
    }
    for (const app of this.live) {
      if (active.has(app)) continue;
      const misses = (this.missing.get(app) ?? 0) + 1;
      if (misses >= this.endAfter) {
        this.live.delete(app);
        this.missing.delete(app);
        changes.push({ state: 'ended', app });
      } else {
        this.missing.set(app, misses);
      }
    }
    return changes;
  }

  /**
   * Forgets every meeting without reporting an end (detection was turned
   * off: the meeting itself goes on, so the page mustn't wind a session down).
   */
  reset(): void {
    this.live.clear();
    this.missing.clear();
  }

  get liveApps(): string[] {
    return [...this.live];
  }
}
