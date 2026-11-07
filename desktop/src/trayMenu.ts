import type { MenuItemConstructorOptions } from 'electron';
import type { DesktopDisplay } from './capture';
import { translate, type Locale } from './i18n';
import type { DesktopCommand } from './policy';

/**
 * The tray menu, as a template: what it shows is decided here (pure, so
 * it's unit tested) and main.ts turns it into a native menu.
 */

export type TrayState = {
  locale: Locale;
  /** The main window shows the live page, where the commands do something. */
  onLivePage: boolean;
  answerWindowOpen: boolean;
  displays: readonly DesktopDisplay[];
  /** The display Start listening captures (the chosen one, or the main display). */
  captureDisplayId: string;
  /** null where meeting detection doesn't exist (anything but Windows). */
  meetingDetection: boolean | null;
  shortcuts: Readonly<Record<DesktopCommand, string>>;
};

export type TrayActions = {
  open(): void;
  command(command: DesktopCommand): void;
  chooseDisplay(id: string): void;
  setMeetingDetection(on: boolean): void;
  openShortcuts(): void;
  quit(): void;
};

/** "Display 2, 2560 × 1440", "DELL U2720Q (main), 3840 × 2160". */
export function displayLabel(display: DesktopDisplay, locale: Locale): string {
  const name = display.primary ? translate(locale, 'displayMain', { name: display.label }) : display.label;
  return translate(locale, 'displayItem', { name, width: display.width, height: display.height });
}

export function trayMenuTemplate(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
  const { locale } = state;
  const command = (id: DesktopCommand, key: 'answerNow' | 'solveScreen' | 'toggleAnswers', enabled: boolean): MenuItemConstructorOptions => ({
    label: translate(locale, key),
    enabled,
    // Shown next to the item as a reminder; the global shortcut does the work.
    ...(state.shortcuts[id] ? { accelerator: state.shortcuts[id], registerAccelerator: false } : {}),
    click: () => actions.command(id),
  });

  const template: MenuItemConstructorOptions[] = [
    { label: translate(locale, 'open'), click: () => actions.open() },
    { type: 'separator' },
    command('answer-now', 'answerNow', state.onLivePage),
    command('solve-screen', 'solveScreen', state.onLivePage),
    command('toggle-answers', 'toggleAnswers', state.onLivePage || state.answerWindowOpen),
    { type: 'separator' },
    {
      label: translate(locale, 'screenToCapture'),
      enabled: state.displays.length > 0,
      submenu: state.displays.map((display) => ({
        label: displayLabel(display, locale),
        type: 'radio',
        checked: display.id === state.captureDisplayId,
        click: () => actions.chooseDisplay(display.id),
      })),
    },
  ];
  if (state.meetingDetection !== null) {
    template.push({
      label: translate(locale, 'detectMeetings'),
      type: 'checkbox',
      checked: state.meetingDetection,
      click: (item) => actions.setMeetingDetection(item.checked),
    });
  }
  template.push(
    { label: translate(locale, 'shortcuts'), click: () => actions.openShortcuts() },
    { type: 'separator' },
    { label: translate(locale, 'quit'), click: () => actions.quit() },
  );
  return template;
}
