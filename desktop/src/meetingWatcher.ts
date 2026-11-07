import { execFile } from 'node:child_process';
import path from 'node:path';
import { activeMeetingApps, MeetingTracker, MICROPHONE_KEY, parseMicrophoneUsers, type MeetingChange } from './meetings';

/**
 * Polls Windows every few seconds for meeting apps using the microphone and
 * reports when one starts or ends (see meetings.ts). Does nothing elsewhere.
 * `reg query` runs without a shell, from System32, never through PATH.
 */

export type RegQuery = (callback: (error: (Error & { code?: number | string | null; killed?: boolean }) | null, stdout: string) => void) => void;

function systemRegQuery(): RegQuery {
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  return (callback) => {
    execFile(
      reg,
      ['query', MICROPHONE_KEY, '/s'],
      { windowsHide: true, timeout: 3_500, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => callback(error, stdout),
    );
  };
}

export class MeetingWatcher {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private readonly tracker = new MeetingTracker(2);

  constructor(
    private readonly onChange: (change: MeetingChange) => void,
    private readonly options: {
      /** Apex Round's own executable, which uses the microphone during a session. */
      ownExecutable: string;
      intervalMs?: number;
      platform?: string;
      query?: RegQuery;
    },
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if ((this.options.platform ?? process.platform) !== 'win32' || this.timer) return;
    this.timer = setInterval(() => this.poll(), this.options.intervalMs ?? 4_000);
    this.timer.unref();
    this.poll();
  }

  /** Stops polling and forgets live meetings without reporting them ended (the meetings themselves go on). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.tracker.reset();
  }

  private poll(): void {
    if (this.polling) return;
    this.polling = true;
    const query = this.options.query ?? systemRegQuery();
    query((error, stdout) => {
      this.polling = false;
      if (!this.timer) return;
      if (error) {
        // reg exits with 1 when the key doesn't exist yet (no app ever asked for the
        // microphone): nothing is in use. A timeout or a failed start tells us nothing.
        if (error.killed || error.code !== 1) return;
      }
      const apps = activeMeetingApps(parseMicrophoneUsers(stdout ?? ''), this.options.ownExecutable);
      for (const change of this.tracker.update(apps)) this.onChange(change);
    });
  }
}
