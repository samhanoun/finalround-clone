import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DesktopSettings } from '@/components/desktop/DesktopSettings';
import type { DesktopDisplay, DesktopSettings as Prefs, DesktopSettingsResult } from '@/lib/desktop';

type TestWindow = Window & { apexDesktop?: unknown };

const DISPLAYS: DesktopDisplay[] = [
  { id: '1', label: 'Display 1', primary: true, width: 1920, height: 1080 },
  { id: '2', label: 'DELL U2720Q', primary: false, width: 3840, height: 2160 },
];

const defaults = (): Prefs => ({
  captureDisplayId: '2',
  shortcuts: {
    'answer-now': 'CommandOrControl+Shift+A',
    'solve-screen': 'CommandOrControl+Shift+S',
    'toggle-answers': 'CommandOrControl+Shift+H',
  },
  meetingDetection: true,
  closeToTray: true,
});

/** A stand-in for the desktop app's preload: settings live in `state.current`. */
function installDesktop(options: {
  platform?: string;
  prefs?: Prefs;
  respond?: (patch: Partial<Prefs>, current: Prefs) => DesktopSettingsResult;
  getSettings?: () => Promise<Prefs>;
} = {}) {
  const state = { current: options.prefs ?? defaults() };
  const bridge = {
    isDesktop: true as const,
    platform: options.platform ?? 'win32',
    getSettings: jest.fn(options.getSettings ?? (async () => state.current)),
    listDisplays: jest.fn(async () => DISPLAYS),
    setSettings: jest.fn(async (patch: Partial<Prefs>) => {
      const result = options.respond ? options.respond(patch, state.current) : { settings: { ...state.current, ...patch }, errors: {} };
      state.current = result.settings;
      return result;
    }),
    pauseShortcuts: jest.fn(async () => undefined),
    hideForCapture: jest.fn(async () => undefined),
    showAfterCapture: jest.fn(async () => undefined),
  };
  (window as TestWindow).apexDesktop = bridge;
  return { bridge, state };
}

afterEach(() => {
  delete (window as TestWindow).apexDesktop;
});

describe('DesktopSettings', () => {
  it('renders nothing in a browser', async () => {
    const { container } = render(<DesktopSettings />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the displays and saves the display and switches at once', async () => {
    const user = userEvent.setup();
    const { bridge } = installDesktop();
    render(<DesktopSettings />);

    const select = (await screen.findByLabelText('Screen to capture')) as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(['Display 1 (main), 1920 × 1080', 'DELL U2720Q, 3840 × 2160']);
    expect(select.value).toBe('2');

    await user.selectOptions(select, '1');
    expect(bridge.setSettings).toHaveBeenLastCalledWith({ captureDisplayId: '1' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Detect meetings' }));
    expect(bridge.setSettings).toHaveBeenLastCalledWith({ meetingDetection: false });
    await user.click(screen.getByRole('switch', { name: 'Keep running in the tray when closed' }));
    expect(bridge.setSettings).toHaveBeenLastCalledWith({ closeToTray: false });
    expect(screen.getByRole('switch', { name: 'Detect meetings' })).not.toBeChecked();
  });

  it('records a new shortcut from the keyboard, with the app shortcuts paused meanwhile', async () => {
    const user = userEvent.setup();
    const { bridge } = installDesktop();
    render(<DesktopSettings />);

    const field = await screen.findByRole('button', { name: 'Answer now: Ctrl+Shift+A. Change the shortcut' });
    await user.click(field);
    expect(bridge.pauseShortcuts).toHaveBeenLastCalledWith(true);
    expect(field).toHaveAttribute('aria-pressed', 'true');
    expect(field).toHaveAccessibleName('Answer now: press the new keys');
    expect(screen.getByText('Esc cancels, Backspace removes the shortcut')).toBeInTheDocument();

    // Holding modifiers shows them; a key completes the shortcut.
    fireEvent.keyDown(field, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(field).toHaveTextContent('Ctrl');
    fireEvent.keyDown(field, { key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true });

    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenLastCalledWith({
        shortcuts: {
          'answer-now': 'CommandOrControl+Alt+J',
          'solve-screen': 'CommandOrControl+Shift+S',
          'toggle-answers': 'CommandOrControl+Shift+H',
        },
      }),
    );
    expect(bridge.pauseShortcuts).toHaveBeenLastCalledWith(false);
    expect(await screen.findByRole('button', { name: 'Answer now: Ctrl+Alt+J. Change the shortcut' })).toHaveAttribute('aria-pressed', 'false');
    // No longer the default: it can be reset.
    expect(screen.getByRole('button', { name: 'Reset Answer now to Ctrl+Shift+A' })).toBeInTheDocument();
  });

  it('shows a shortcut another app holds as an inline error and keeps the old one', async () => {
    const user = userEvent.setup();
    const { bridge } = installDesktop({ respond: (_patch, current) => ({ settings: current, errors: { 'solve-screen': 'taken' } }) });
    render(<DesktopSettings />);

    const field = await screen.findByRole('button', { name: 'Solve screen: Ctrl+Shift+S. Change the shortcut' });
    await user.click(field);
    fireEvent.keyDown(field, { key: 'F9', code: 'F9' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Another app already uses these keys');
    expect(bridge.setSettings).toHaveBeenCalledTimes(1);
    expect(field).toHaveAccessibleName('Solve screen: Ctrl+Shift+S. Change the shortcut');
    expect(field).toHaveAccessibleDescription('Another app already uses these keys');
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('catches keys that cannot work before asking the desktop app', async () => {
    const user = userEvent.setup();
    const { bridge } = installDesktop();
    render(<DesktopSettings />);
    const field = await screen.findByRole('button', { name: 'Answer now: Ctrl+Shift+A. Change the shortcut' });

    // A bare letter would swallow typing everywhere.
    await user.click(field);
    fireEvent.keyDown(field, { key: 'k', code: 'KeyK' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Use Ctrl, Alt or Win with another key, or a function key');
    expect(field).toHaveAttribute('aria-pressed', 'true'); // still listening

    // Another command's shortcut.
    fireEvent.keyDown(field, { key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Already used for Solve screen');

    // One of the answer window's fixed shortcuts.
    await user.click(field);
    fireEvent.keyDown(field, { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Used to move or resize the answer window');

    expect(bridge.setSettings).not.toHaveBeenCalled();
  });

  it('Esc cancels, Backspace clears, and Reset brings the default back', async () => {
    const user = userEvent.setup();
    const { bridge } = installDesktop();
    render(<DesktopSettings />);
    const field = await screen.findByRole('button', { name: 'Show or hide the answer window: Ctrl+Shift+H. Change the shortcut' });

    await user.click(field);
    fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' });
    expect(field).toHaveAttribute('aria-pressed', 'false');
    expect(bridge.pauseShortcuts).toHaveBeenLastCalledWith(false);
    expect(bridge.setSettings).not.toHaveBeenCalled();

    await user.click(field);
    fireEvent.keyDown(field, { key: 'Backspace', code: 'Backspace' });
    await waitFor(() => expect(bridge.setSettings).toHaveBeenCalledTimes(1));
    expect(bridge.setSettings.mock.calls[0][0].shortcuts?.['toggle-answers']).toBe('');
    const cleared = await screen.findByRole('button', { name: 'Show or hide the answer window: no shortcut. Set one' });
    expect(cleared).toHaveTextContent('Not set');

    await user.click(screen.getByRole('button', { name: 'Reset Show or hide the answer window to Ctrl+Shift+H' }));
    await waitFor(() => expect(bridge.setSettings.mock.calls[1][0].shortcuts?.['toggle-answers']).toBe('CommandOrControl+Shift+H'));
    expect(await screen.findByRole('button', { name: 'Show or hide the answer window: Ctrl+Shift+H. Change the shortcut' })).toBeInTheDocument();
  });

  it('lists the answer window’s fixed shortcuts', async () => {
    installDesktop();
    render(<DesktopSettings />);
    expect(await screen.findByText('Move the answer window')).toBeInTheDocument();
    expect(screen.getByText('Resize the answer window')).toBeInTheDocument();
    expect(screen.getByText('Put the answer window back')).toBeInTheDocument();
    expect(screen.getAllByText('←↑→↓')).toHaveLength(2);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText("These work while the answer window is open and can't be changed")).toBeInTheDocument();
  });

  it('on a Mac: Mac keys, no meeting detection, and the menu bar instead of the tray', async () => {
    installDesktop({ platform: 'darwin' });
    render(<DesktopSettings />);
    expect(await screen.findByRole('button', { name: 'Answer now: ⌘+⇧+A. Change the shortcut' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Detect meetings' })).not.toBeInTheDocument();
    expect(screen.getByText('Closing the window hides it. To quit, use the icon in the menu bar.')).toBeInTheDocument();
  });

  it('says so when the settings cannot be read', async () => {
    installDesktop({ getSettings: () => Promise.reject(new Error('ipc failed')) });
    render(<DesktopSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't read the desktop app's settings. Restart Apex Round and try again.");
  });

  it('picks up changes made from the tray when the window regains focus', async () => {
    const { state } = installDesktop();
    render(<DesktopSettings />);
    const select = (await screen.findByLabelText('Screen to capture')) as HTMLSelectElement;
    expect(select.value).toBe('2');

    state.current = { ...state.current, captureDisplayId: '1' };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(select.value).toBe('1'));
  });

  it('resumes the shortcuts if the page goes away mid-recording', async () => {
    const user = userEvent.setup();
    const { bridge } = installDesktop();
    const { unmount } = render(<DesktopSettings />);
    await user.click(await screen.findByRole('button', { name: 'Answer now: Ctrl+Shift+A. Change the shortcut' }));
    expect(bridge.pauseShortcuts).toHaveBeenLastCalledWith(true);
    unmount();
    expect(bridge.pauseShortcuts).toHaveBeenLastCalledWith(false);
  });
});
