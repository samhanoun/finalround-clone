import { DESKTOP_COMMAND_EVENT, isDesktopApp, onDesktopCommand } from '@/lib/desktop';

const dispatch = (detail: unknown) => window.dispatchEvent(new CustomEvent(DESKTOP_COMMAND_EVENT, { detail }));

afterEach(() => {
  delete (window as Window & { apexDesktop?: unknown }).apexDesktop;
});

describe('desktop bridge', () => {
  it('detects the desktop app from its preload flag', () => {
    expect(isDesktopApp()).toBe(false);
    (window as Window & { apexDesktop?: unknown }).apexDesktop = { isDesktop: true, platform: 'win32' };
    expect(isDesktopApp()).toBe(true);
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
});
