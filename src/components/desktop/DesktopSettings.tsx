'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  DESKTOP_COMMANDS,
  DESKTOP_DEFAULT_SHORTCUTS,
  desktopPlatform,
  desktopSettingsApi,
  pauseDesktopShortcuts,
  type DesktopCommand,
  type DesktopDisplay,
  type DesktopSettings as DesktopPrefs,
  type DesktopShortcutError,
} from '@/lib/desktop';
import { GroupFooter, SaveNote, SettingRow, SettingsGroup, settingsStyles, Switch, type SaveState } from '@/app/[locale]/settings/SettingsUI';
import {
  answerWindowModifiers,
  heldModifiers,
  isAnswerWindowShortcut,
  readShortcut,
  sameShortcut,
  shortcutParts,
  type ShortcutPart,
} from './shortcutKeys';
import styles from './DesktopSettings.module.css';

/** Why a shortcut wasn't changed: from the desktop app (taken, invalid) or caught here first. */
type Problem = { kind: DesktopShortcutError | 'duplicate' | 'reserved'; other?: DesktopCommand };

/** Named keys that have a label in Desktop.keys. */
const KEY_LABELS: Record<string, string> = {
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
  Space: 'space',
  Enter: 'enter',
  Return: 'enter',
  Escape: 'escape',
  Esc: 'escape',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
  Tab: 'tab',
  // Not an accelerator key: "any arrow" in the answer window's fixed shortcuts.
  arrows: 'arrows',
};

const noSubscription = () => () => undefined;

/** Counter-clockwise arrow: back to the default. Drawn like src/components/icons.tsx. */
function ResetIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

/**
 * Settings → Desktop app (only inside the desktop app): the display to
 * capture, the global shortcuts, meeting detection and close-to-tray. The
 * desktop app keeps these on this computer; each change applies at once.
 * Renders nothing in a browser.
 */
export function DesktopSettings() {
  const t = useTranslations('Desktop');
  const platform = useSyncExternalStore(noSubscription, desktopPlatform, () => null);
  const mac = platform === 'darwin';
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  const [displays, setDisplays] = useState<DesktopDisplay[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [problems, setProblems] = useState<Partial<Record<DesktopCommand, Problem>>>({});
  const [recording, setRecording] = useState<DesktopCommand | null>(null);
  const [held, setHeld] = useState<ShortcutPart[]>([]);
  const pausedRef = useRef(false);
  const base = useId();
  const displayId = `${base}-display`;

  // Load now, and again when the window comes back: the tray menu can change
  // the display and meeting detection while this page is open.
  useEffect(() => {
    const api = desktopSettingsApi();
    if (!api) return;
    let active = true;
    const load = () => {
      Promise.all([api.getSettings(), api.listDisplays()]).then(
        ([nextPrefs, nextDisplays]) => {
          if (!active) return;
          setPrefs(nextPrefs);
          setDisplays(nextDisplays);
          setLoadFailed(false);
        },
        () => {
          if (active) setLoadFailed(true);
        },
      );
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, []);

  // Tray → Shortcuts… opens /settings#desktop: the browser jumped there before this had content.
  const loaded = prefs !== null;
  useEffect(() => {
    if (loaded && window.location.hash === '#desktop') document.getElementById('desktop')?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = window.setTimeout(() => setSaveState('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  // Leaving the page mid-recording gives the shortcuts back.
  useEffect(
    () => () => {
      if (pausedRef.current) void pauseDesktopShortcuts(false);
    },
    [],
  );

  if (!loaded) {
    if (!loadFailed) return null;
    return (
      <SettingsGroup>
        <p className={`${settingsStyles.block} ${settingsStyles.inlineError}`} role="alert">
          {t('loadFailed')}
        </p>
      </SettingsGroup>
    );
  }

  const setProblem = (command: DesktopCommand, problem: Problem | undefined) =>
    setProblems((current) => ({ ...current, [command]: problem }));

  async function save(patch: Partial<DesktopPrefs>) {
    const api = desktopSettingsApi();
    if (!api) return null;
    setSaveState('saving');
    try {
      const result = await api.setSettings(patch);
      setPrefs(result.settings);
      return result;
    } catch {
      setSaveState('error');
      return null;
    }
  }

  async function saveSimple(patch: Partial<DesktopPrefs>) {
    if (await save(patch)) setSaveState('saved');
  }

  async function changeShortcut(command: DesktopCommand, accelerator: string) {
    if (!prefs) return;
    if (accelerator) {
      const other = DESKTOP_COMMANDS.find((candidate) => candidate !== command && sameShortcut(prefs.shortcuts[candidate], accelerator, platform));
      if (other) return setProblem(command, { kind: 'duplicate', other });
      if (isAnswerWindowShortcut(accelerator, platform)) return setProblem(command, { kind: 'reserved' });
    }
    const result = await save({ shortcuts: { ...prefs.shortcuts, [command]: accelerator } });
    if (!result) return;
    const error = result.errors[command];
    setProblem(command, error ? { kind: error } : undefined);
    setSaveState(error ? 'idle' : 'saved');
  }

  function startRecording(command: DesktopCommand) {
    setRecording(command);
    setHeld([]);
    setProblem(command, undefined);
    pausedRef.current = true;
    // Our own shortcuts would swallow the keys before the page sees them.
    void pauseDesktopShortcuts(true);
  }

  function stopRecording() {
    setRecording(null);
    setHeld([]);
    if (pausedRef.current) {
      pausedRef.current = false;
      void pauseDesktopShortcuts(false);
    }
  }

  function onFieldKeyDown(command: DesktopCommand, event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (recording !== command) return;
    const outcome = readShortcut(event.nativeEvent, platform);
    if (outcome.type === 'tab') {
      stopRecording(); // and let Tab move on
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    switch (outcome.type) {
      case 'modifiers':
        setHeld(heldModifiers(event.nativeEvent, platform));
        return;
      case 'cancel':
        stopRecording();
        return;
      case 'clear':
        stopRecording();
        void changeShortcut(command, '');
        return;
      case 'invalid':
        setHeld([]);
        setProblem(command, { kind: 'invalid' });
        return;
      case 'accelerator':
        stopRecording();
        void changeShortcut(command, outcome.accelerator);
        return;
    }
  }

  function keyLabel(part: ShortcutPart): string {
    if (part.kind === 'modifier') {
      switch (part.name) {
        case 'CommandOrControl':
          return mac ? t('keys.cmd') : t('keys.ctrl');
        case 'Command':
          return t('keys.cmd');
        case 'Control':
          return mac ? t('keys.control') : t('keys.ctrl');
        case 'Super':
          return mac ? t('keys.cmd') : t('keys.win');
        case 'Alt':
          return mac ? t('keys.option') : t('keys.alt');
        case 'Shift':
          return mac ? t('keys.shiftMac') : t('keys.shift');
        default:
          return part.name;
      }
    }
    if (KEY_LABELS[part.name]) return t(`keys.${KEY_LABELS[part.name]}`);
    const numpad = /^num(\d)$/.exec(part.name);
    return numpad ? t('keys.numpad', { key: numpad[1] }) : part.name;
  }

  const spoken = (accelerator: string) => shortcutParts(accelerator).map(keyLabel).join('+');

  const keycaps = (parts: ShortcutPart[]) => (
    <span className={styles.keys}>
      {parts.map((part, index) => (
        <kbd key={`${part.name}-${index}`} className={part.name === 'arrows' ? styles.arrowKeys : undefined}>
          {keyLabel(part)}
        </kbd>
      ))}
    </span>
  );

  function problemText(problem: Problem): string {
    switch (problem.kind) {
      case 'taken':
        return t('errors.taken');
      case 'invalid':
        return mac ? t('errors.invalidMac') : t('errors.invalid');
      case 'reserved':
        return t('errors.reserved');
      case 'duplicate':
        return t('errors.duplicate', { command: problem.other ? t(`commands.${problem.other}`) : '' });
    }
  }

  const primary = displays.find((display) => display.primary) ?? displays[0];
  const captureValue =
    prefs.captureDisplayId !== null && displays.some((display) => display.id === prefs.captureDisplayId) ? prefs.captureDisplayId : primary?.id ?? '';
  const saving = saveState === 'saving';
  const windowModifiers: ShortcutPart[] = answerWindowModifiers(platform).map((name) => ({ kind: 'modifier', name }));
  const arrows: ShortcutPart = { kind: 'key', name: 'arrows' };
  const fixedRows: Array<{ key: 'move' | 'resize' | 'back'; parts: ShortcutPart[] }> = [
    { key: 'move', parts: [...windowModifiers, arrows] },
    { key: 'resize', parts: [...windowModifiers, { kind: 'modifier', name: 'Shift' }, arrows] },
    { key: 'back', parts: [...windowModifiers, { kind: 'key', name: 'Home' }] },
  ];

  return (
    <>
      <SettingsGroup>
        {displays.length > 0 ? (
          <SettingRow label={t('capture')} htmlFor={displayId} help={t('captureHelp')}>
            <select
              id={displayId}
              className="select"
              value={captureValue}
              disabled={saving}
              onChange={(event) => void saveSimple({ captureDisplayId: event.target.value })}
            >
              {displays.map((display) => (
                <option key={display.id} value={display.id}>
                  {t(display.primary ? 'displayMain' : 'display', { name: display.label, width: display.width, height: display.height })}
                </option>
              ))}
            </select>
          </SettingRow>
        ) : null}

        {platform === 'win32' ? (
          <SettingRow layout="inline" label={t('detect')} htmlFor={`${base}-detect`} help={t('detectHelp')} helpId={`${base}-detect-help`}>
            <Switch
              id={`${base}-detect`}
              checked={prefs.meetingDetection}
              disabled={saving}
              describedBy={`${base}-detect-help`}
              onChange={(checked) => void saveSimple({ meetingDetection: checked })}
            />
          </SettingRow>
        ) : null}

        <SettingRow layout="inline" label={t('tray')} htmlFor={`${base}-tray`} help={mac ? t('trayHelpMac') : t('trayHelp')} helpId={`${base}-tray-help`}>
          <Switch
            id={`${base}-tray`}
            checked={prefs.closeToTray}
            disabled={saving}
            describedBy={`${base}-tray-help`}
            onChange={(checked) => void saveSimple({ closeToTray: checked })}
          />
        </SettingRow>

        <SaveNote state={saveState} saved={t('saved')} error={t('notSaved')} inSection />
      </SettingsGroup>

      <div className={styles.shortcutsHead}>
        <h3 className={styles.shortcutsTitle}>{t('shortcuts')}</h3>
        <p className={styles.shortcutsDesc}>{t('shortcutsHelp')}</p>
      </div>

      <SettingsGroup>
        {DESKTOP_COMMANDS.map((command) => {
          const accelerator = prefs.shortcuts[command];
          const isRecording = recording === command;
          const problem = problems[command];
          const labelId = `${base}-${command}-label`;
          const helpId = `${base}-${command}-help`;
          const fallback = DESKTOP_DEFAULT_SHORTCUTS[command];
          const isDefault = sameShortcut(accelerator, fallback, platform);
          const name = t(`commands.${command}`);
          const help = problem ? (
            <span className={styles.problem} role="alert">
              {problemText(problem)}
            </span>
          ) : isRecording ? (
            t('recordingHint')
          ) : undefined;
          return (
            <SettingRow key={command} layout="inline" label={name} labelId={labelId} help={help} helpId={helpId}>
              <span className={styles.shortcut}>
                <button
                  type="button"
                  className={styles.field}
                  aria-pressed={isRecording}
                  data-problem={problem ? '' : undefined}
                  aria-label={
                    isRecording
                      ? t('recordingLabel', { command: name })
                      : accelerator
                        ? t('changeLabel', { command: name, keys: spoken(accelerator) })
                        : t('setLabel', { command: name })
                  }
                  aria-describedby={help ? helpId : undefined}
                  disabled={saving && !isRecording}
                  onClick={() => (isRecording ? stopRecording() : startRecording(command))}
                  onKeyDown={(event) => onFieldKeyDown(command, event)}
                  onKeyUp={(event) => {
                    if (isRecording) setHeld(heldModifiers(event.nativeEvent, platform));
                  }}
                  onBlur={() => {
                    if (isRecording) stopRecording();
                  }}
                >
                  {isRecording ? (
                    held.length > 0 ? (
                      keycaps(held)
                    ) : (
                      <span className={styles.prompt}>{t('recording')}</span>
                    )
                  ) : accelerator ? (
                    keycaps(shortcutParts(accelerator))
                  ) : (
                    <span className={styles.empty}>{t('notSet')}</span>
                  )}
                </button>
                {isDefault ? (
                  <span className={styles.resetSlot} aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    className={`iconButton ${styles.reset}`}
                    aria-label={t('resetLabel', { command: name, keys: spoken(fallback) })}
                    title={t('reset')}
                    disabled={saving}
                    onClick={() => {
                      stopRecording();
                      void changeShortcut(command, fallback);
                    }}
                  >
                    <ResetIcon />
                  </button>
                )}
              </span>
            </SettingRow>
          );
        })}

        {fixedRows.map((row) => (
          <SettingRow key={row.key} layout="inline" label={t(`window.${row.key}`)}>
            <span className={styles.shortcut}>
              <span className={styles.fixed}>{keycaps(row.parts)}</span>
              <span className={styles.resetSlot} aria-hidden="true" />
            </span>
          </SettingRow>
        ))}

        <GroupFooter note={t('windowNote')} />
      </SettingsGroup>
    </>
  );
}
