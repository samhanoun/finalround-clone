'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import styles from './SessionBar.module.css';

const MODES = ['general', 'coding', 'phone', 'video'];

/** m:ss, or h:mm:ss after an hour. */
export function elapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Re-renders once a second for the elapsed time. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The running session, quietly: a live dot, the time in session, the title,
 * one muted line of details, and how to end it. With `debug`, the event
 * stream's state too.
 */
export function SessionBar({
  session,
  streamState,
  onStop,
  stopping,
  debug = false,
}: {
  session: { id: string; title: string | null; status: string; started_at: string; metadata?: Record<string, unknown> | null };
  streamState: string;
  onStop: () => void;
  stopping: boolean;
  debug?: boolean;
}) {
  const t = useTranslations('SessionBar');
  const format = useFormatter();
  const now = useNow();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // A new session: bring its title into view (Start session may sit low on a
  // long setup) and tell screen readers where they are.
  useEffect(() => {
    headingRef.current?.focus();
  }, [session.id]);
  const mode = typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';
  const hasContext = Boolean(session.metadata?.context_pack);
  const started = new Date(session.started_at);
  const startedAt = format.dateTime(started, { hour: 'numeric', minute: '2-digit' });

  return (
    <section className={styles.bar} aria-label={t('label')}>
      <div className={styles.main}>
        <p className={styles.live}>
          <span className={styles.dot} aria-hidden="true" />
          <span className="srOnly">{t('live')}</span>
          <time className={styles.clock} dateTime={session.started_at} title={t('liveSince', { time: startedAt })}>
            {elapsedClock(now - started.getTime())}
          </time>
        </p>
        <h1 ref={headingRef} className={styles.title} tabIndex={-1}>
          {session.title?.trim() || t('label')}
        </h1>
      </div>
      <p className={styles.details}>
        <span>{MODES.includes(mode) ? t(`modes.${mode}`) : mode}</span>
        <span>{hasContext ? t('withContext') : t('noContext')}</span>
        {debug ? (
          <span aria-live="polite">{t('events', { state: t.has(`stream.${streamState}`) ? t(`stream.${streamState}`) : streamState })}</span>
        ) : null}
      </p>
      <button className={`button buttonDanger ${styles.stop}`} type="button" onClick={() => onStop()} disabled={stopping}>
        {stopping ? t('stopping') : t('stop')}
      </button>
    </section>
  );
}
