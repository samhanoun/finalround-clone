'use client';

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

  return (
    <section className="card" aria-label="Live session">
      <div className="cardInner row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 6 }}>
          <h2 className="cardTitle" style={{ margin: 0 }}>
            {session.title?.trim() || 'Live session'}
          </h2>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="badge">{MODE_LABEL[mode] ?? mode}</span>
            <span className="badge">Running since {new Date(session.started_at).toLocaleTimeString()}</span>
            <span className="badge" aria-live="polite">
              Events: {streamState}
            </span>
            <span className="badge">{hasContext ? 'Using your interview context' : 'No interview context'}</span>
          </div>
        </div>
        <button className="button buttonDanger" type="button" onClick={onStop} disabled={stopping}>
          {stopping ? 'Stopping…' : 'Stop session'}
        </button>
      </div>
    </section>
  );
}
