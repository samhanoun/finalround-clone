import type { ReactNode } from 'react';
import { CheckIcon } from '@/components/icons';
import styles from './Settings.module.css';

/**
 * The building blocks of Settings: a titled section, a group of rows, a row
 * (label and help on the left, the control on the right; stacked on phones),
 * a footer for Save, a quiet save state, a switch and a segmented choice.
 * No hooks here, so the server page and the client sections share them.
 */

export { styles as settingsStyles };

export function SettingsSection(props: {
  id: string;
  title: string;
  desc?: ReactNode;
  /** Shown only inside the desktop app (html[data-desktop]). */
  desktopOnly?: boolean;
  children?: ReactNode;
}) {
  const titleId = `${props.id}-title`;
  return (
    <section
      id={props.id}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`${styles.section} ${props.desktopOnly ? styles.desktopOnly : ''}`}
    >
      <header className={styles.sectionHead}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {props.title}
        </h2>
        {props.desc ? <p className={styles.sectionDesc}>{props.desc}</p> : null}
      </header>
      {props.children}
    </section>
  );
}

export function SettingsGroup(props: { children: ReactNode; danger?: boolean; label?: string }) {
  return (
    <div className={`${styles.group} ${props.danger ? styles.groupDanger : ''}`} role={props.label ? 'group' : undefined} aria-label={props.label}>
      {props.children}
    </div>
  );
}

type RowLayout = 'split' | 'inline' | 'stacked';

/**
 * `htmlFor` makes the label a <label> for that control; otherwise pass
 * `labelId` and point the control at it with aria-labelledby.
 */
export function SettingRow(props: {
  label: ReactNode;
  help?: ReactNode;
  htmlFor?: string;
  labelId?: string;
  helpId?: string;
  /** Extra text on the label's line, at the right (a count). */
  aside?: ReactNode;
  layout?: RowLayout;
  /** role="status" on the help, for help that changes (device notifications). */
  helpLive?: boolean;
  children?: ReactNode;
}) {
  const layout = props.layout ?? 'split';
  const label = props.htmlFor ? (
    <label htmlFor={props.htmlFor} id={props.labelId} className={styles.rowLabel}>
      {props.label}
    </label>
  ) : (
    <span id={props.labelId} className={styles.rowLabel}>
      {props.label}
    </span>
  );
  return (
    <div className={`${styles.row} ${layout === 'inline' ? styles.rowInline : layout === 'stacked' ? styles.rowStacked : ''}`}>
      <div className={styles.rowText}>
        {props.aside ? (
          <div className={styles.rowTitleLine}>
            {label}
            {props.aside}
          </div>
        ) : (
          label
        )}
        {props.help ? (
          <p id={props.helpId} className={styles.rowHelp} role={props.helpLive ? 'status' : undefined}>
            {props.help}
          </p>
        ) : null}
      </div>
      {props.children !== undefined ? <div className={styles.rowControl}>{props.children}</div> : null}
    </div>
  );
}

export function GroupFooter(props: { note?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.groupFooter}>
      {props.note ? <p className={styles.footerNote}>{props.note}</p> : null}
      <div className={styles.footerActions}>{props.children}</div>
    </div>
  );
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The quiet save state. The status line is always in the page, so screen
 * readers hear "Saved"; an error is an alert. `inSection` puts it beside the
 * section title (sections that save on their own).
 */
export function SaveNote(props: { state: SaveState; saved: string; error?: string | null; inSection?: boolean }) {
  const where = props.inSection ? styles.sectionStatus : '';
  if (props.state === 'error' && props.error) {
    // In a section that saves on its own, the error is a line at the end of the group.
    return props.inSection ? (
      <p className={`${styles.block} ${styles.inlineError}`} role="alert">
        {props.error}
      </p>
    ) : (
      <span className={`${styles.status} ${styles.statusError}`} role="alert">
        {props.error}
      </span>
    );
  }
  return (
    <span className={`${styles.status} ${where}`} role="status">
      {props.state === 'saved' ? (
        <>
          <CheckIcon size={14} />
          {props.saved}
        </>
      ) : null}
    </span>
  );
}

/** An on/off setting that applies at once. */
export function Switch(props: {
  id?: string;
  checked: boolean;
  disabled?: boolean;
  labelledBy?: string;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      id={props.id}
      type="checkbox"
      role="switch"
      className={styles.switch}
      checked={props.checked}
      disabled={props.disabled}
      aria-labelledby={props.labelledBy}
      aria-describedby={props.describedBy}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  );
}

/** One choice out of a few, as a row of segments (radio buttons underneath). */
export function Segmented<T extends string>(props: {
  name: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  labelledBy?: string;
  label?: string;
  describedBy?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-labelledby={props.labelledBy}
      aria-label={props.label}
      aria-describedby={props.describedBy}
    >
      {props.options.map((option) => (
        <label key={option.value} className={styles.segment}>
          <input
            type="radio"
            name={props.name}
            value={option.value}
            checked={props.value === option.value}
            disabled={props.disabled}
            onChange={() => props.onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
