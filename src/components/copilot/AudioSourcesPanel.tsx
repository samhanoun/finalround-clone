'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import type { CaptureLevels } from '@/lib/audio/capture';
import { isDesktopApp } from '@/lib/desktop';
import { shareSteps, type MeetingPlatform } from '@/lib/meetingSettings';
import { hasSignal, levelToPercent } from '@/lib/audio/levels';
import { ChevronDownIcon, ExternalIcon, MicIcon } from '@/components/icons';
import styles from './AudioSourcesPanel.module.css';
import type { AudioCapture } from './useAudioCapture';
import type { LiveCaptions, LiveTranscription } from './useLiveTranscription';
import type { VoiceSample } from './useVoiceSample';

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

/** A short help line that opens into the steps. */
function Help({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className={styles.help}>
      <summary className={styles.helpSummary}>
        <ChevronDownIcon size={16} className={styles.chevron} />
        {summary}
      </summary>
      <div className={styles.helpBody}>{children}</div>
    </details>
  );
}

/** What Start listening will ask for: share steps for this meeting in the browser, how the desktop app listens. */
function ShareHelp({ share }: { share?: ShareGuide }) {
  const t = useTranslations('AudioSources');
  const tSteps = useTranslations('ShareSteps');
  // The server never renders the desktop text, so it reads the bridge after hydration.
  const desktop = useSyncExternalStore(noSubscription, isDesktopApp, () => false);
  const mac = useSyncExternalStore(noSubscription, isMac, () => false);
  if (desktop) {
    return (
      <Help summary={t('desktopHelpToggle')}>
        <p>{t('desktopHelp')}</p>
      </Help>
    );
  }
  const platform = share?.platform ?? 'auto';
  const steps = shareSteps({
    platform,
    desktopApp: share?.desktopApp ?? false,
    mac,
    useMicrophone: share?.useMicrophone ?? true,
  });
  return (
    <Help summary={t('shareHelpToggle')}>
      <ol className={styles.steps}>
        {steps.map((step) => (
          <li key={step}>{tSteps(step, { platform })}</li>
        ))}
      </ol>
    </Help>
  );
}

/**
 * The talk track: one live trace per voice (Ice for the interviewer, Ember
 * for you), what each is saying right now, and Start or Stop listening.
 */
export function AudioSourcesPanel({
  capture,
  transcription,
  disabled,
  share,
  voiceSample,
  mobileBar = false,
}: {
  capture: AudioCapture;
  transcription?: LiveTranscription;
  disabled: boolean;
  /** Settings → Meeting apps and the meeting link, for the share steps. */
  share?: ShareGuide;
  /** Phone / in-person mode: one microphone for both people, told apart by this sample. */
  voiceSample?: VoiceSample;
  /** Phones: the listen toggle lives in the page's bottom bar. */
  mobileBar?: boolean;
}) {
  const t = useTranslations('AudioSources');
  const { status, error, start, stop, subscribeLevels } = capture;
  const live = status === 'live';
  const singleMic = voiceSample !== undefined;

  return (
    <section className={`${styles.panel} ${mobileBar ? styles.withMobileBar : ''}`} aria-label={t('title')}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.state}>
          <span className={live ? styles.stateOn : undefined}>{t(`capture.${status}`)}</span>
          {transcription && live ? <span>{t(`stt.${transcription.status}`)}</span> : null}
        </p>
      </header>

      <Traces subscribe={subscribeLevels} active={live} singleMic={singleMic} />

      {transcription && live ? <Captions captions={transcription.captions} /> : null}

      {voiceSample ? <VoiceSampleBlock sample={voiceSample} live={live} /> : null}

      <div className={`${styles.actions} ${styles.listenRow}`}>
        <button
          className={`button ${styles.listen}`}
          type="button"
          onClick={live ? stop : () => void start()}
          disabled={disabled || status === 'starting'}
        >
          <MicIcon size={16} className={styles.listenIcon} />
          {live ? t('stop') : status === 'starting' ? t('starting') : t('start')}
        </button>
        {share?.meetingLink ? (
          <a className="button buttonGhost" href={share.meetingLink} target="_blank" rel="noopener noreferrer">
            <ExternalIcon size={16} />
            {t('openMeeting')}
          </a>
        ) : null}
      </div>

      {!live ? (
        singleMic ? (
          <Help summary={t('roomHelpToggle')}>
            <p>{t('roomHelp')}</p>
          </Help>
        ) : (
          <ShareHelp share={share} />
        )
      ) : null}

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
function VoiceSampleBlock({ sample, live }: { sample: VoiceSample; live: boolean }) {
  const t = useTranslations('AudioSources');
  return (
    <div className={styles.voiceSample} data-state={sample.state}>
      <p className={styles.voiceTitle}>{t('voice.title')}</p>
      {sample.state === 'recording' ? (
        <>
          <p className={styles.readAloud}>{t('voice.readAloud')}</p>
          <div
            className={styles.progress}
            role="progressbar"
            aria-label={t('voice.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(sample.progress * 100)}
          >
            <div className={styles.progressFill} style={{ transform: `scaleX(${sample.progress})` }} />
          </div>
          <div className={styles.actions}>
            <button className="button buttonSmall" type="button" onClick={sample.cancel}>
              {t('voice.cancel')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.voiceText}>{sample.state === 'ready' ? t('voice.ready') : t('voice.missing')}</p>
          {sample.tooQuiet ? (
            <p className="error" role="status">
              {t('voice.tooQuiet')}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button
              className="button buttonSmall"
              type="button"
              onClick={sample.record}
              disabled={!live}
              title={live ? undefined : t('voice.startFirst')}
            >
              {sample.state === 'ready' ? t('voice.recordAgain') : t('voice.record')}
            </button>
            {sample.state === 'ready' ? (
              <button className="button buttonSmall buttonGhost" type="button" onClick={sample.forget}>
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

/** About five seconds of levels at the capture's 20 updates a second. */
const HISTORY = 100;
const TRACE_HEIGHT = 24;

type VoiceKey = 'interviewer' | 'you' | 'room';
type Voice = { key: VoiceKey; label: string };

/** The interviewer is the shared meeting audio; you (or the room, on one microphone) are the microphone. */
const channelOf = (key: VoiceKey): keyof CaptureLevels => (key === 'interviewer' ? 'interviewer' : 'candidate');

/** The level history as an SVG path, oldest on the left, newest on the right. */
function tracePath(history: Float32Array, head: number): string {
  let d = '';
  for (let i = 0; i < HISTORY; i += 1) {
    const level = history[(head + i) % HISTORY];
    const y = TRACE_HEIGHT - 1.5 - (levelToPercent(level) / 100) * (TRACE_HEIGHT - 3);
    d += `${i === 0 ? 'M' : 'L'}${i} ${y.toFixed(1)}`;
  }
  return d;
}

/**
 * Two thin live traces, the product's signature: who is speaking, as it
 * happens. Drawn straight into the SVG from the level subscription (20 times a
 * second) without re-rendering React.
 */
function Traces({ subscribe, active, singleMic }: { subscribe: AudioCapture['subscribeLevels']; active: boolean; singleMic: boolean }) {
  const t = useTranslations('AudioSources');
  const voices: Voice[] = singleMic
    ? [{ key: 'room', label: t('roomMeter') }]
    : [
        { key: 'interviewer', label: t('interviewerMeter') },
        { key: 'you', label: t('youMeter') },
      ];
  const paths = useRef(new Map<VoiceKey, SVGPathElement>());
  const meters = useRef(new Map<VoiceKey, HTMLElement>());
  const hearing = t('hearing');
  const quiet = t('quiet');

  useEffect(() => {
    const history: Record<keyof CaptureLevels, Float32Array> = {
      interviewer: new Float32Array(HISTORY),
      candidate: new Float32Array(HISTORY),
    };
    let head = 0;
    const draw = (levels: CaptureLevels) => {
      history.interviewer[head] = levels.interviewer;
      history.candidate[head] = levels.candidate;
      head = (head + 1) % HISTORY;
      for (const [key, path] of paths.current) {
        path.setAttribute('d', tracePath(history[channelOf(key)], head));
      }
      for (const [key, meter] of meters.current) {
        const level = levels[channelOf(key)];
        const signal = hasSignal(level);
        meter.setAttribute('aria-valuenow', String(Math.round(levelToPercent(level))));
        meter.setAttribute('aria-valuetext', signal ? hearing : quiet);
        meter.toggleAttribute('data-signal', signal);
      }
    };
    // Flat until audio is live; the history starts over each time.
    draw({ interviewer: 0, candidate: 0 });
    if (!active) return;
    return subscribe(draw);
  }, [subscribe, active, hearing, quiet]);

  return (
    <div className={styles.traces}>
      {voices.map((voice) => (
        <div key={voice.key} className={styles.trace} data-voice={voice.key}>
          <span className={styles.traceLabel}>{voice.label}</span>
          <div
            ref={(element) => {
              if (element) meters.current.set(voice.key, element);
              else meters.current.delete(voice.key);
            }}
            className={styles.meter}
            role="meter"
            aria-label={t('levelLabel', { label: voice.label })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            aria-valuetext={quiet}
          >
            <svg className={styles.line} viewBox={`0 0 ${HISTORY - 1} ${TRACE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <path
                ref={(element) => {
                  if (element) paths.current.set(voice.key, element);
                  else paths.current.delete(voice.key);
                }}
                d={`M0 ${TRACE_HEIGHT - 1.5}H${HISTORY - 1}`}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
