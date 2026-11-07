/**
 * Settings → Meeting apps: how the live copilot connects to the interview.
 * Stored in video_conferencing_settings; safe to import in the browser.
 *
 * - platform / desktopApp: where interviews usually happen, so Start listening
 *   explains exactly what to share;
 * - askForLink: the setup step asks for the meeting link, detects the app from
 *   it and offers to open it;
 * - autoStartListening: Start session goes straight on to Start listening;
 * - endWhenSharingStops: stopping the share ends the session after 2 minutes;
 * - useMicrophone: off leaves your side silent (the interviewer only).
 */

export type MeetingPlatform = 'auto' | 'zoom' | 'google_meet' | 'ms_teams';

export type MeetingSettings = {
  platform: MeetingPlatform;
  desktopApp: boolean;
  askForLink: boolean;
  autoStartListening: boolean;
  endWhenSharingStops: boolean;
  useMicrophone: boolean;
};

export const DEFAULT_MEETING_SETTINGS: MeetingSettings = {
  platform: 'auto',
  desktopApp: false,
  askForLink: true,
  autoStartListening: false,
  endWhenSharingStops: true,
  useMicrophone: true,
};

export const PLATFORM_LABEL: Record<Exclude<MeetingPlatform, 'auto'>, string> = {
  zoom: 'Zoom',
  google_meet: 'Google Meet',
  ms_teams: 'Microsoft Teams',
};

export type MeetingSettingsRow = {
  preferred_platform?: string | null;
  uses_desktop_meeting_app?: boolean | null;
  auto_detect_platform?: boolean | null;
  auto_start_listening?: boolean | null;
  screen_share_detection_enabled?: boolean | null;
  audio_capture_enabled?: boolean | null;
};

const PLATFORMS: MeetingPlatform[] = ['auto', 'zoom', 'google_meet', 'ms_teams'];

export function meetingSettingsFromRow(row: MeetingSettingsRow | null | undefined): MeetingSettings {
  if (!row) return DEFAULT_MEETING_SETTINGS;
  const flag = (value: boolean | null | undefined, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  return {
    platform: PLATFORMS.includes(row.preferred_platform as MeetingPlatform) ? (row.preferred_platform as MeetingPlatform) : 'auto',
    desktopApp: flag(row.uses_desktop_meeting_app, DEFAULT_MEETING_SETTINGS.desktopApp),
    askForLink: flag(row.auto_detect_platform, DEFAULT_MEETING_SETTINGS.askForLink),
    autoStartListening: flag(row.auto_start_listening, DEFAULT_MEETING_SETTINGS.autoStartListening),
    endWhenSharingStops: flag(row.screen_share_detection_enabled, DEFAULT_MEETING_SETTINGS.endWhenSharingStops),
    useMicrophone: flag(row.audio_capture_enabled, DEFAULT_MEETING_SETTINGS.useMicrophone),
  };
}

export function meetingSettingsToRow(settings: MeetingSettings): Required<MeetingSettingsRow> {
  return {
    preferred_platform: settings.platform,
    uses_desktop_meeting_app: settings.desktopApp,
    auto_detect_platform: settings.askForLink,
    auto_start_listening: settings.autoStartListening,
    screen_share_detection_enabled: settings.endWhenSharingStops,
    audio_capture_enabled: settings.useMicrophone,
  };
}

const LINK_PATTERNS: Array<[Exclude<MeetingPlatform, 'auto'>, RegExp]> = [
  ['zoom', /(^|\.)zoom\.(us|com)$|(^|\.)zoomgov\.com$/],
  ['google_meet', /^meet\.google\.com$/],
  ['ms_teams', /(^|\.)teams\.(microsoft|live)\.com$|^teams\.cloud\.microsoft$/],
];

/** The meeting app a link belongs to, or null (not a link, or another app). */
export function detectMeetingPlatform(link: string): Exclude<MeetingPlatform, 'auto'> | null {
  const url = meetingUrl(link);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  return LINK_PATTERNS.find(([, pattern]) => pattern.test(host))?.[0] ?? null;
}

/** An http(s) URL from what the user pasted ("meet.google.com/abc" works too), or null. */
export function meetingUrl(link: string): URL | null {
  const trimmed = link.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** One step of the share instructions; the UI words it from ShareSteps.<key> with the platform. */
export type ShareStep =
  | 'macCantHear'
  | 'joinInChrome'
  | 'entireScreen'
  | 'systemAudio'
  | 'pickTab'
  | 'tabAudio'
  | 'allowMic';

/** What to pick in Chrome's share prompt for this meeting, as short steps. */
export function shareSteps({
  platform,
  desktopApp,
  mac,
  useMicrophone = true,
}: {
  platform: MeetingPlatform;
  desktopApp: boolean;
  mac: boolean;
  useMicrophone?: boolean;
}): ShareStep[] {
  const mic: ShareStep[] = useMicrophone ? ['allowMic'] : [];
  if (desktopApp && platform !== 'google_meet') {
    if (mac) return ['macCantHear', 'joinInChrome'];
    return ['entireScreen', 'systemAudio', ...mic];
  }
  return ['pickTab', 'tabAudio', ...mic];
}
