'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CaptureLevels } from '@/lib/audio/capture';
import { isDesktopApp } from '@/lib/desktop';
import { hasSignal, levelToPercent } from '@/lib/audio/levels';
import styles from './AudioSourcesPanel.module.css';
import type { LiveSttStatus } from '@/lib/stt/deepgramLive';
import type { AudioCapture, AudioCaptureStatus } from './useAudioCapture';
import type { LiveCaptions, LiveTranscription } from './useLiveTranscription';

const SILENT: CaptureLevels = { candidate: 0, interviewer: 0 };

const STATUS_LABEL: Record<AudioCaptureStatus, string> = {
  idle: 'Not listening',
  starting: 'Starting…',
  live: 'Listening',
  error: 'Not listening',
};

const STT_LABEL: Record<LiveSttStatus, string> = {
  idle: 'Transcription off',
  connecting: 'Connecting transcription…',
  live: 'Transcribing',
  reconnecting: 'Reconnecting…',
  closed: 'Transcription off',
  error: 'Transcription stopped',
};

/** What Start listening will ask for: a share picker in the browser, nothing in the desktop app. */
function ShareHelp() {
  // The server never renders the desktop text, so it reads the bridge after hydration.
  const desktop = useSyncExternalStore(noSubscription, isDesktopApp, () => false);
  return desktop ? (
    <p className={`small ${styles.help}`}>
      The desktop app listens to everything your PC plays, so meeting apps like Zoom and Teams work too, and it reads your
      main screen for Solve screen. Wear headphones so your own speakers don&apos;t feed back into the microphone.
    </p>
  ) : (
    <p className={`small ${styles.help}`}>
      Chrome will ask what to share: pick the tab with your interview (Google Meet, Zoom or Teams in the browser) and
      tick <strong>Share tab audio</strong>. On Windows you can share the entire screen with <strong>Share system
      audio</strong> to cover desktop meeting apps. Then allow the microphone.
    </p>
  );
}

const noSubscription = () => () => undefined;

export function AudioSourcesPanel({
  capture,
  transcription,
  disabled,
}: {
  capture: AudioCapture;
  transcription?: LiveTranscription;
  disabled: boolean;
}) {
  const { status, error, start, stop, subscribeLevels } = capture;
  const live = status === 'live';

  return (
    <section className={styles.panel} aria-label="Audio sources">
      <div className={styles.header}>
        <h3 className={styles.title}>Audio sources</h3>
        <div className={styles.badges}>
          <span className="badge">{STATUS_LABEL[status]}</span>
          {transcription && live ? <span className="badge">{STT_LABEL[transcription.status]}</span> : null}
        </div>
      </div>

      <LevelMeters subscribe={subscribeLevels} active={live} />

      {transcription && live ? <Captions captions={transcription.captions} /> : null}

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

      {!live ? <ShareHelp /> : null}

      {error ? (
        <div className="error" role="status" aria-live="polite">
          {error}
        </div>
      ) : null}

      {transcription?.error ? (
        <div className="error" role="status" aria-live="polite">
          {transcription.error}
        </div>
      ) : null}
    </section>
  );
}

// Interim text changes several times a second, so captions are not a live
// region; finished lines are announced through the transcript instead.
function Captions({ captions }: { captions: LiveCaptions }) {
  return (
    <div className={styles.captions} aria-label="Live captions">
      <p className={styles.caption} data-voice="interviewer">
        <span className={styles.captionSpeaker}>Interviewer</span>
        <span className={captions.interviewer ? undefined : styles.captionIdle}>{captions.interviewer || '…'}</span>
      </p>
      <p className={styles.caption} data-voice="you">
        <span className={styles.captionSpeaker}>You</span>
        <span className={captions.candidate ? undefined : styles.captionIdle}>{captions.candidate || '…'}</span>
      </p>
    </div>
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
      <Meter voice="interviewer" label="Interviewer (shared audio)" level={shown.interviewer} />
      <Meter voice="you" label="You (microphone)" level={shown.candidate} />
    </div>
  );
}

function Meter({ voice, label, level }: { voice: 'interviewer' | 'you'; label: string; level: number }) {
  const percent = levelToPercent(level);
  const signal = hasSignal(level);
  return (
    <div className={styles.meter} data-voice={voice}>
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
