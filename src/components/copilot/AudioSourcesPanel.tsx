'use client';

import { useEffect, useState } from 'react';
import type { CaptureLevels } from '@/lib/audio/capture';
import { hasSignal, levelToPercent } from '@/lib/audio/levels';
import styles from './AudioSourcesPanel.module.css';
import type { AudioCapture, AudioCaptureStatus } from './useAudioCapture';

const SILENT: CaptureLevels = { candidate: 0, interviewer: 0 };

const STATUS_LABEL: Record<AudioCaptureStatus, string> = {
  idle: 'Not listening',
  starting: 'Starting…',
  live: 'Listening',
  error: 'Not listening',
};

export function AudioSourcesPanel({ capture, disabled }: { capture: AudioCapture; disabled: boolean }) {
  const { status, error, start, stop, subscribeLevels } = capture;
  const live = status === 'live';

  return (
    <section className={styles.panel} aria-label="Audio sources">
      <div className={styles.header}>
        <h3 className={styles.title}>Audio sources</h3>
        <span className="badge">{STATUS_LABEL[status]}</span>
      </div>

      <LevelMeters subscribe={subscribeLevels} active={live} />

      <div className={styles.actions}>
        <button
          className={`button ${live ? '' : 'buttonPrimary'}`}
          type="button"
          onClick={live ? stop : () => void start()}
          disabled={disabled || status === 'starting'}
        >
          {live ? 'Stop listening' : status === 'starting' ? 'Starting…' : 'Start listening'}
        </button>
      </div>

      {!live ? (
        <p className={`small ${styles.help}`}>
          Chrome will ask what to share: pick the tab with your interview (Google Meet, Zoom or Teams in the browser) and
          tick <strong>Share tab audio</strong>. On Windows you can share the entire screen with <strong>Share system
          audio</strong> to cover desktop meeting apps. Then allow the microphone.
        </p>
      ) : null}

      {error ? (
        <div className="error" role="status" aria-live="polite">
          {error}
        </div>
      ) : null}
    </section>
  );
}

function LevelMeters({
  subscribe,
  active,
}: {
  subscribe: AudioCapture['subscribeLevels'];
  active: boolean;
}) {
  const [levels, setLevels] = useState<CaptureLevels>(SILENT);

  useEffect(() => subscribe(setLevels), [subscribe]);

  const shown = active ? levels : SILENT;
  return (
    <div className={styles.meters}>
      <Meter label="You (microphone)" level={shown.candidate} />
      <Meter label="Interviewer (shared audio)" level={shown.interviewer} />
    </div>
  );
}

function Meter({ label, level }: { label: string; level: number }) {
  const percent = levelToPercent(level);
  const signal = hasSignal(level);
  return (
    <div className={styles.meter}>
      <div className={styles.meterLabel}>
        <span>{label}</span>
        <span className={signal ? styles.signalOn : styles.signalOff}>{signal ? 'Hearing audio' : 'Quiet'}</span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-label={`${label} level`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
