'use client';

import styles from './SessionBar.module.css';

const MODE_LABEL: Record<string, string> = {
  general: 'General interview',
  coding: 'Coding interview',
  phone: 'Phone screen',
  video: 'Video call',
};

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
  const mode = typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';
  const hasContext = Boolean(session.metadata?.context_pack);
  const startedAt = new Date(session.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <section className={styles.bar} aria-label="Live session">
      <div className={styles.titleBlock}>
        <h2 className={styles.title}>{session.title?.trim() || 'Live session'}</h2>
        <div className={styles.chips}>
          <span className="badge badgeLive">Live since {startedAt}</span>
          <span className="badge">{MODE_LABEL[mode] ?? mode}</span>
          <span className="badge">{hasContext ? 'Using your résumé and the job' : 'No résumé or job added'}</span>
          <span className="badge" aria-live="polite">
            Events: {streamState}
          </span>
        </div>
      </div>
      <button className="button buttonDanger" type="button" onClick={() => onStop()} disabled={stopping}>
        {stopping ? 'Stopping…' : 'Stop session'}
      </button>
    </section>
  );
}
