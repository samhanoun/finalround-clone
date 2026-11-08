'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import styles from './Controls.module.css';

/**
 * One choice out of a few, as a row of segments (a radio group): click a
 * segment, or move with the arrow keys like any radio group. Used by practice
 * setup, cover letters and the goals workspace.
 */
export function Segmented<V extends string | number>(props: {
  label: string;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (value: V) => void;
  /** The label stays for screen readers but isn't shown. */
  hideLabel?: boolean;
}) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value),
  );

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = props.options.length - 1;
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (target < 0) return;
    event.preventDefault();
    props.onChange(props.options[target].value);
    refs.current[target]?.focus();
  }

  return (
    <div className={styles.field}>
      <span id={labelId} className={props.hideLabel ? 'srOnly' : styles.label}>
        {props.label}
      </span>
      <div className={styles.segmented} role="radiogroup" aria-labelledby={labelId} data-count={props.options.length}>
        {props.options.map((option, index) => (
          <button
            key={String(option.value)}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={option.value === props.value}
            tabIndex={index === selected ? 0 : -1}
            className={styles.segment}
            onClick={() => props.onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** An on/off setting: the label (and a line of help) on the left, the switch on the right. */
export function Switch(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const helpId = useId();
  return (
    <div className={styles.switchRow}>
      <span className={styles.switchText}>
        <label htmlFor={id} className={styles.switchLabel}>
          {props.label}
        </label>
        {props.description ? (
          <span id={helpId} className={styles.switchHelp}>
            {props.description}
          </span>
        ) : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-describedby={props.description ? helpId : undefined}
        className={styles.switch}
        onClick={() => props.onChange(!props.checked)}
        disabled={props.disabled}
      >
        <span className={styles.thumb} aria-hidden="true" />
      </button>
    </div>
  );
}
