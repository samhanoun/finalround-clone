import {
  DESKTOP_COMMAND_EVENT,
  DESKTOP_DEFAULT_SHORTCUTS,
  DESKTOP_MEETING_EVENT,
  desktopPlatform,
  desktopSettingsApi,
  isDesktopApp,
  onDesktopCommand,
  onDesktopMeeting,
  pauseDesktopShortcuts,
  withAnswerWindowHidden,
} from '@/lib/desktop';

type TestWindow = Window & { apexDesktop?: unknown };
const setBridge = (bridge: unknown) => {
  (window as TestWindow).apexDesktop = bridge;
};
const dispatch = (detail: unknown) => window.dispatchEvent(new CustomEvent(DESKTOP_COMMAND_EVENT, { detail }));
const dispatchMeeting = (detail: unknown) => window.dispatchEvent(new CustomEvent(DESKTOP_MEETING_EVENT, { detail }));

afterEach(() => {
  delete (window as TestWindow).apexDesktop;
});

describe('desktop bridge', () => {
  it('detects the desktop app from its preload flag', () => {
    expect(isDesktopApp()).toBe(false);
    expect(desktopPlatform()).toBeNull();
    setBridge({ isDesktop: true, platform: 'win32' });
    expect(isDesktopApp()).toBe(true);
    expect(desktopPlatform()).toBe('win32');
    setBridge({ isDesktop: 'yes', platform: 'win32' });
    expect(isDesktopApp()).toBe(false);
  });

  it('passes known shortcut commands to the listener and ignores anything else', () => {
    const listener = jest.fn();
    const unsubscribe = onDesktopCommand(listener);

    dispatch('answer-now');
    dispatch('solve-screen');
    dispatch('rm -rf');
    dispatch({ command: 'answer-now' });
    expect(listener.mock.calls).toEqual([['answer-now'], ['solve-screen']]);

    unsubscribe();
    dispatch('toggle-answers');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('passes meeting starts and ends, capping the app name, and ignores malformed events', () => {
    const listener = jest.fn();
    const unsubscribe = onDesktopMeeting(listener);

    dispatchMeeting({ state: 'started', app: 'Zoom' });
    dispatchMeeting({ state: 'ended', app: 'Microsoft Teams' });
    dispatchMeeting({ state: 'started', app: 'x'.repeat(60) });
    dispatchMeeting({ state: 'paused', app: 'Zoom' });
    dispatchMeeting({ state: 'started' });
    dispatchMeeting(null);
    expect(listener.mock.calls).toEqual([
      [{ state: 'started', app: 'Zoom' }],
      [{ state: 'ended', app: 'Microsoft Teams' }],
      [{ state: 'started', app: 'x'.repeat(40) }],
    ]);

    unsubscribe();
    dispatchMeeting({ state: 'started', app: 'Zoom' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('offers the settings API only when the desktop app has all of it', () => {
    expect(desktopSettingsApi()).toBeNull();
    setBridge({ isDesktop: true, platform: 'win32', getSettings: jest.fn() });
    expect(desktopSettingsApi()).toBeNull();
    const getSettings = jest.fn();
    const setSettings = jest.fn();
    const listDisplays = jest.fn();
    setBridge({ isDesktop: true, platform: 'win32', getSettings, setSettings, listDisplays });
    expect(desktopSettingsApi()).toEqual({ getSettings, setSettings, listDisplays });
  });

  it('pauses and resumes the desktop shortcuts, and does nothing in a browser', async () => {
    await expect(pauseDesktopShortcuts(true)).resolves.toBeUndefined();
    const pauseShortcuts = jest.fn().mockResolvedValue(undefined);
    setBridge({ isDesktop: true, platform: 'win32', pauseShortcuts });
    await pauseDesktopShortcuts(true);
    await pauseDesktopShortcuts(false);
    expect(pauseShortcuts.mock.calls).toEqual([[true], [false]]);
    // A failing bridge doesn't throw into the page.
    setBridge({ isDesktop: true, platform: 'win32', pauseShortcuts: jest.fn().mockRejectedValue(new Error('gone')) });
    await expect(pauseDesktopShortcuts(true)).resolves.toBeUndefined();
  });

  it('keeps the default shortcuts in step with the desktop app', () => {
    expect(DESKTOP_DEFAULT_SHORTCUTS).toEqual({
      'answer-now': 'CommandOrControl+Shift+A',
      'solve-screen': 'CommandOrControl+Shift+S',
      'toggle-answers': 'CommandOrControl+Shift+H',
    });
  });
});

describe('withAnswerWindowHidden', () => {
  it('just runs the capture in a browser', async () => {
    await expect(withAnswerWindowHidden(async () => 'frame')).resolves.toBe('frame');
  });

  it('hides the answer window around the capture, in order', async () => {
    const calls: string[] = [];
    setBridge({
      isDesktop: true,
      platform: 'win32',
      hideForCapture: jest.fn(async () => {
        calls.push('hide');
      }),
      showAfterCapture: jest.fn(async () => {
        calls.push('show');
      }),
    });
    const frame = await withAnswerWindowHidden(async () => {
      calls.push('capture');
      return 'frame';
    });
    expect(frame).toBe('frame');
    expect(calls).toEqual(['hide', 'capture', 'show']);
  });

  it('shows the window again when the capture fails, and captures even if hiding fails', async () => {
    const showAfterCapture = jest.fn().mockResolvedValue(undefined);
    setBridge({ isDesktop: true, platform: 'win32', hideForCapture: jest.fn().mockRejectedValue(new Error('no window')), showAfterCapture });
    await expect(
      withAnswerWindowHidden(async () => {
        throw new Error('capture failed');
      }),
    ).rejects.toThrow('capture failed');
    expect(showAfterCapture).toHaveBeenCalledTimes(1);

    await expect(withAnswerWindowHidden(async () => 42)).resolves.toBe(42);
  });
});
