'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertIcon } from '@/components/icons';
import styles from './LiveNotice.module.css';

/** How long a session waits after meeting audio sharing stops before it ends itself. */
export const SHARING_GRACE_MS = 120_000;

export function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Time left until `startedAt + graceMs`, ticking once a second; calls `onExpire` once at zero. */
export function useCountdown(startedAt: number, graceMs: number, onExpire: () => void): number {
  const [remaining, setRemaining] = useState(graceMs);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    const deadline = startedAt + graceMs;
    let expired = false;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      setRemaining(left);
      if (left === 0 && !expired) {
        expired = true;
        clearInterval(timer);
        onExpireRef.current();
      }
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt, graceMs]);

  return remaining;
}

/**
 * Shown when the user stops sharing the meeting: the session (and its billed
 * minutes) ends after a grace period unless they start listening again or
 * choose to keep it open, for example to type questions instead. The alert is
 * read once; the ticking time inside it is a timer, which isn't re-read.
 */
export function AutoEndNotice({
  startedAt,
  graceMs = SHARING_GRACE_MS,
  onExpire,
  onKeepOpen,
}: {
  startedAt: number;
  graceMs?: number;
  onExpire: () => void;
  onKeepOpen: () => void;
}) {
  const t = useTranslations('AutoEndNotice');
  const remaining = useCountdown(startedAt, graceMs, onExpire);

  return (
    <div className={styles.notice} role="alert">
      <AlertIcon size={18} className={styles.icon} />
      <p className={styles.text}>
        {t.rich('message', {
          time: clock(remaining),
          strong: (chunks) => (
            <strong role="timer" aria-live="off" className={styles.time}>
              {chunks}
            </strong>
          ),
        })}
      </p>
      <div className={styles.actions}>
        <button className="button buttonSmall" type="button" onClick={onKeepOpen}>
          {t('keepOpen')}
        </button>
      </div>
    </div>
  );
}
