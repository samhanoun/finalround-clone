'use client';

import { useFormatter, useTranslations } from 'next-intl';
import styles from './SessionBar.module.css';

const MODES = ['general', 'coding', 'phone', 'video'];

/** The running session: what it is, whether events are flowing, and how to end it. */
export function SessionBar({
  session,
  streamState,
  onStop,
  stopping,
}: {
  session: { id: string; title: string | null; status: string; started_at: string; metadata?: Record<string, unknown> | null };
  streamState: string;
  onStop: () => void;
  stopping: boolean;
}) {
  const t = useTranslations('SessionBar');
  const format = useFormatter();
  const mode = typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';
  const hasContext = Boolean(session.metadata?.context_pack);
  const startedAt = format.dateTime(new Date(session.started_at), { hour: 'numeric', minute: '2-digit' });

  return (
    <section className={styles.bar} aria-label={t('label')}>
      <div className={styles.titleBlock}>
        <h2 className={styles.title}>{session.title?.trim() || t('label')}</h2>
        <div className={styles.chips}>
          <span className="badge badgeLive">{t('liveSince', { time: startedAt })}</span>
          <span className="badge">{MODES.includes(mode) ? t(`modes.${mode}`) : mode}</span>
          <span className="badge">{hasContext ? t('withContext') : t('noContext')}</span>
          <span className="badge" aria-live="polite">
            {t('events', { state: t.has(`stream.${streamState}`) ? t(`stream.${streamState}`) : streamState })}
          </span>
        </div>
      </div>
      <button className="button buttonDanger" type="button" onClick={() => onStop()} disabled={stopping}>
        {stopping ? t('stopping') : t('stop')}
      </button>
    </section>
  );
}
