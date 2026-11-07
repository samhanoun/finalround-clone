'use client';

import { useTranslations } from 'next-intl';
import { AlertIcon, CloseIcon } from '@/components/icons';
import { useCountdown } from './AutoEndNotice';
import styles from './LiveNotice.module.css';

/** How long a session waits after the meeting app lets go of the microphone (desktop app). */
export const MEETING_GRACE_MS = 30_000;

/**
 * Desktop app, during a session: the meeting app stopped using the
 * microphone, so the meeting is probably over. The session ends when the
 * countdown runs out, unless the user keeps going.
 */
export function MeetingEndedNotice({
  app,
  startedAt,
  graceMs = MEETING_GRACE_MS,
  onExpire,
  onKeepGoing,
  onEndNow,
  ending = false,
}: {
  app: string;
  startedAt: number;
  graceMs?: number;
  onExpire: () => void;
  onKeepGoing: () => void;
  onEndNow: () => void;
  ending?: boolean;
}) {
  const t = useTranslations('LiveMeeting');
  const remaining = useCountdown(startedAt, graceMs, onExpire);

  return (
    <div className={styles.notice} role="alert">
      <AlertIcon size={18} className={styles.icon} />
      <p className={styles.text}>
        {t.rich('ended', {
          app,
          seconds: Math.ceil(remaining / 1000),
          timer: (chunks) => (
            <strong role="timer" aria-live="off" className={styles.time}>
              {chunks}
            </strong>
          ),
        })}
      </p>
      <div className={styles.actions}>
        <button className="button buttonSmall" type="button" onClick={onKeepGoing}>
          {t('keepGoing')}
        </button>
        <button className="button buttonSmall buttonDanger" type="button" onClick={onEndNow} disabled={ending}>
          {t('endNow')}
        </button>
      </div>
    </div>
  );
}

/** Desktop app, before a session: a meeting app is using the microphone. */
export function MeetingStartedNotice({
  app,
  onStart,
  onDismiss,
  starting = false,
}: {
  app: string;
  onStart: () => void;
  onDismiss: () => void;
  starting?: boolean;
}) {
  const t = useTranslations('LiveMeeting');
  return (
    <div className={`${styles.notice} ${styles.quiet}`} role="status">
      <span className={styles.liveDot} aria-hidden="true" />
      <p className={`${styles.text} ${styles.twoLines}`}>
        <span className={styles.lead}>{t('started', { app })}</span>
        <span className={styles.sub}>{t('startedHelp')}</span>
      </p>
      <div className={styles.actions}>
        <button className="button buttonSmall" type="button" onClick={onStart} disabled={starting}>
          {t('startNow')}
        </button>
        <button className="iconButton" type="button" onClick={onDismiss} aria-label={t('dismiss')} title={t('dismiss')}>
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}
