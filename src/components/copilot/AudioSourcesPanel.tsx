'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import type { CaptureLevels } from '@/lib/audio/capture';
import { isDesktopApp } from '@/lib/desktop';
import { shareSteps, type MeetingPlatform } from '@/lib/meetingSettings';
import { hasSignal, levelToPercent } from '@/lib/audio/levels';
import styles from './AudioSourcesPanel.module.css';
import type { AudioCapture } from './useAudioCapture';
import type { LiveCaptions, LiveTranscription } from './useLiveTranscription';
import type { VoiceSample } from './useVoiceSample';

const SILENT: CaptureLevels = { candidate: 0, interviewer: 0 };

/** What Start listening will ask for: share steps for this meeting in the browser, nothing in the desktop app. */
function ShareHelp({ share }: { share?: ShareGuide }) {
  const t = useTranslations('AudioSources');
  const tSteps = useTranslations('ShareSteps');
  // The server never renders the desktop text, so it reads the bridge after hydration.
  const desktop = useSyncExternalStore(noSubscription, isDesktopApp, () => false);
  const mac = useSyncExternalStore(noSubscription, isMac, () => false);
  if (desktop) {
    return <p className={`small ${styles.help}`}>{t('desktopHelp')}</p>;
  }
  const platform = share?.platform ?? 'auto';
  const steps = shareSteps({
    platform,
    desktopApp: share?.desktopApp ?? false,
    mac,
    useMicrophone: share?.useMicrophone ?? true,
  });
  return (
    <div className={`small ${styles.help}`}>
      <ol className={styles.steps}>
        {steps.map((step) => (
          <li key={step}>{tSteps(step, { platform })}</li>
        ))}
      </ol>
      {share?.meetingLink ? (
        <a className="button buttonGhost" href={share.meetingLink} target="_blank" rel="noopener noreferrer">
          {t('openMeeting')}
        </a>
      ) : null}
    </div>
  );
}

export type ShareGuide = {
  platform: MeetingPlatform;
  desktopApp: boolean;
  useMicrophone: boolean;
  meetingLink?: string;
};

function isMac() {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
}

const noSubscription = () => () => undefined;

export function AudioSourcesPanel({
  capture,
  transcription,
  disabled,
  share,
  voiceSample,
}: {
  capture: AudioCapture;
  transcription?: LiveTranscription;
  disabled: boolean;
  /** Settings → Meeting apps and the meeting link, for the share steps. */
  share?: ShareGuide;
  /** Phone / in-person mode: one microphone for both people, told apart by this sample. */
  voiceSample?: VoiceSample;
}) {
  const t = useTranslations('AudioSources');
  const { status, error, start, stop, subscribeLevels } = capture;
  const live = status === 'live';
  const singleMic = voiceSample !== undefined;

  return (
    <section className={styles.panel} aria-label={t('title')}>
      <div className={styles.header}>
        <h3 className={styles.title}>{t('title')}</h3>
        <div className={styles.badges}>
          <span className="badge">{t(`capture.${status}`)}</span>
          {transcription && live ? <span className="badge">{t(`stt.${transcription.status}`)}</span> : null}
        </div>
      </div>

      <LevelMeters subscribe={subscribeLevels} active={live} singleMic={singleMic} />

      {voiceSample ? <VoiceSampleCard sample={voiceSample} live={live} /> : null}

      {transcription && live ? <Captions captions={transcription.captions} /> : null}

      <div className={styles.actions}>
        <button
          className={`button ${live ? '' : 'buttonPrimary'}`}
          type="button"
          onClick={live ? stop : () => void start()}
          disabled={disabled || status === 'starting'}
        >
          {live ? t('stop') : status === 'starting' ? t('starting') : t('start')}
        </button>
      </div>

      {!live ? singleMic ? <p className={`small ${styles.help}`}>{t('roomHelp')}</p> : <ShareHelp share={share} /> : null}

      {error ? (
        <div className="error" role="status" aria-live="polite">
          {t(`captureErrors.${error}`)}
        </div>
      ) : null}

      {transcription?.error ? (
        <div className="error" role="status" aria-live="polite">
          {transcription.errorCode ? t(`sttErrors.${transcription.errorCode}`) : transcription.error}
        </div>
      ) : null}
    </section>
  );
}

/** Phone / in-person mode: record a few seconds of the candidate's voice so the two voices can be told apart. */
function VoiceSampleCard({ sample, live }: { sample: VoiceSample; live: boolean }) {
  const t = useTranslations('AudioSources');
  return (
    <div className={styles.voiceSample} data-state={sample.state}>
      <p className={styles.voiceTitle}>{t('voice.title')}</p>
      {sample.state === 'recording' ? (
        <>
          <p className={styles.readAloud}>{t('voice.readAloud')}</p>
          <div
            className={styles.track}
            role="progressbar"
            aria-label={t('voice.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(sample.progress * 100)}
          >
            <div className={styles.fill} style={{ width: `${sample.progress * 100}%` }} />
          </div>
          <div className={styles.actions}>
            <button className="button" type="button" onClick={sample.cancel}>
              {t('voice.cancel')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small">{sample.state === 'ready' ? t('voice.ready') : t('voice.missing')}</p>
          {sample.tooQuiet ? (
            <p className="error" role="status">
              {t('voice.tooQuiet')}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              className={`button ${sample.state === 'ready' ? '' : 'buttonPrimary'}`}
              type="button"
              onClick={sample.record}
              disabled={!live}
              title={live ? undefined : t('voice.startFirst')}
            >
              {sample.state === 'ready' ? t('voice.recordAgain') : t('voice.record')}
            </button>
            {sample.state === 'ready' ? (
              <button className="button buttonGhost" type="button" onClick={sample.forget}>
                {t('voice.forget')}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// Interim text changes several times a second, so captions are not a live
// region; finished lines are announced through the transcript instead.
function Captions({ captions }: { captions: LiveCaptions }) {
  const t = useTranslations('AudioSources');
  return (
    <div className={styles.captions} aria-label={t('captions')}>
      <p className={styles.caption} data-voice="interviewer">
        <span className={styles.captionSpeaker}>{t('interviewer')}</span>
        <span className={captions.interviewer ? undefined : styles.captionIdle}>{captions.interviewer || '…'}</span>
      </p>
      <p className={styles.caption} data-voice="you">
        <span className={styles.captionSpeaker}>{t('you')}</span>
        <span className={captions.candidate ? undefined : styles.captionIdle}>{captions.candidate || '…'}</span>
      </p>
    </div>
  );
}

function LevelMeters({
  subscribe,
  active,
  singleMic,
}: {
  subscribe: AudioCapture['subscribeLevels'];
  active: boolean;
  singleMic: boolean;
}) {
  const t = useTranslations('AudioSources');
  const [levels, setLevels] = useState<CaptureLevels>(SILENT);

  useEffect(() => subscribe(setLevels), [subscribe]);

  const shown = active ? levels : SILENT;
  if (singleMic) {
    return (
      <div className={styles.meters}>
        <Meter voice="you" label={t('roomMeter')} level={shown.candidate} />
      </div>
    );
  }
  return (
    <div className={styles.meters}>
      <Meter voice="interviewer" label={t('interviewerMeter')} level={shown.interviewer} />
      <Meter voice="you" label={t('youMeter')} level={shown.candidate} />
    </div>
  );
}

function Meter({ voice, label, level }: { voice: 'interviewer' | 'you'; label: string; level: number }) {
  const t = useTranslations('AudioSources');
  const percent = levelToPercent(level);
  const signal = hasSignal(level);
  return (
    <div className={styles.meter} data-voice={voice}>
      <div className={styles.meterLabel}>
        <span>{label}</span>
        <span className={signal ? styles.signalOn : styles.signalOff}>{signal ? t('hearing') : t('quiet')}</span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-label={t('levelLabel', { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className={styles.fill} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
