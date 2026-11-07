import {
  DEFAULT_MEETING_SETTINGS,
  detectMeetingPlatform,
  meetingSettingsFromRow,
  meetingSettingsToRow,
  meetingUrl,
  shareSteps,
} from '@/lib/meetingSettings';

describe('meeting settings rows', () => {
  it('round-trips through the table columns', () => {
    const settings = {
      platform: 'zoom' as const,
      desktopApp: true,
      askForLink: false,
      autoStartListening: true,
      endWhenSharingStops: false,
      useMicrophone: false,
    };
    expect(meetingSettingsFromRow(meetingSettingsToRow(settings))).toEqual(settings);
  });

  it('uses the defaults for a missing row or unknown values', () => {
    expect(meetingSettingsFromRow(null)).toEqual(DEFAULT_MEETING_SETTINGS);
    expect(meetingSettingsFromRow({ preferred_platform: 'webex' }).platform).toBe('auto');
  });
});

describe('detectMeetingPlatform', () => {
  it.each([
    ['https://us02web.zoom.us/j/123456789?pwd=abc', 'zoom'],
    ['zoom.us/j/1', 'zoom'],
    ['https://meet.google.com/abc-defg-hij', 'google_meet'],
    ['https://teams.microsoft.com/l/meetup-join/19%3a', 'ms_teams'],
    ['https://teams.live.com/meet/123', 'ms_teams'],
  ])('%s → %s', (link, platform) => {
    expect(detectMeetingPlatform(link)).toBe(platform);
  });

  it('ignores look-alikes and non-links', () => {
    expect(detectMeetingPlatform('https://zoom.us.evil.example/j/1')).toBeNull();
    expect(detectMeetingPlatform('https://notmeet.google.com.example')).toBeNull();
    expect(detectMeetingPlatform('javascript:alert(1)')).toBeNull();
    expect(meetingUrl('javascript:alert(1)')).toBeNull();
    expect(meetingUrl('not a link at all')).toBeNull();
  });
});

describe('shareSteps', () => {
  it('asks for the tab and its audio for browser meetings', () => {
    expect(shareSteps({ platform: 'google_meet', desktopApp: false, mac: false })).toEqual(['pickTab', 'tabAudio', 'allowMic']);
  });

  it('asks for the entire screen with system audio for desktop apps on Windows', () => {
    expect(shareSteps({ platform: 'zoom', desktopApp: true, mac: false, useMicrophone: false })).toEqual(['entireScreen', 'systemAudio']);
  });

  it('explains the Mac limit for desktop apps', () => {
    expect(shareSteps({ platform: 'ms_teams', desktopApp: true, mac: true })).toEqual(['macCantHear', 'joinInChrome']);
  });
});
