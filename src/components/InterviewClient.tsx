'use client';

import { useMemo, useState } from 'react';
import { ShareReport } from './ShareReport';

type Msg = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  created_at: string;
};

type Feedback = {
  id: string;
  score: number | null;
  notes: string | null;
  rubric: Record<string, unknown>;
  created_at: string;
};

export function InterviewClient(props: {
  sessionId: string;
  initialMessages: Msg[];
  initialFeedback?: Feedback[];
}) {
  const [messages, setMessages] = useState<Msg[]>(props.initialMessages ?? []);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');

  const [score, setScore] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [rubric, setRubric] = useState<string>('{}');
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState<string | null>(null);

  const feedback = props.initialFeedback ?? [];

  const exportUrl = useMemo(() => `/api/interviews/${props.sessionId}/export`, [props.sessionId]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text) return;

    setError(null);
    setFeedbackSaved(null);
    setSending(true);
    setDraft('');

    try {
      const res = await fetch(`/api/interviews/${props.sessionId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Failed to send');

      setMessages((m) => [...m, json.message]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  async function saveFeedback() {
    setError(null);
    setFeedbackSaved(null);
    setSavingFeedback(true);

    let rubricObj: Record<string, unknown> = {};
    try {
      rubricObj = rubric.trim() ? JSON.parse(rubric) : {};
    } catch {
      setSavingFeedback(false);
      setError('Rubric must be valid JSON');
      return;
    }

    const payload: { notes?: string; rubric: Record<string, unknown>; score?: number } = {
      notes: notes.trim() || undefined,
      rubric: rubricObj,
    };
    if (score.trim()) payload.score = Number(score);

    try {
      const res = await fetch(`/api/interviews/${props.sessionId}/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Failed to save feedback');

      setFeedbackSaved('Saved. (Refresh to see it in the list)');
      setScore('');
      setNotes('');
      setRubric('{}');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSavingFeedback(false);
    }
  }

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <section className="card" aria-label="Chat">
        <div className="cardInner stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="cardTitle">Chat</h2>
            <a className="button" href={exportUrl} target="_blank" rel="noreferrer">
              Export
            </a>
          </div>

          <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {messages.length ? (
              messages.map((m) => (
                <li key={m.id} className="card" style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'none' }}>
                  <div className="cardInner stack" style={{ gap: 6 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="badge">{m.role}</span>
                      <span className="small mono">{new Date(m.created_at).toLocaleString()}</span>
                    </div>
                    <p style={{ margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                  </div>
                </li>
              ))
            ) : (
              <li className="small">No messages yet. Start with a question or answer.</li>
            )}
          </ol>

          <hr className="hr" />

          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
          >
            <label className="label">
              Your message
              <textarea
                className="textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your answer / question…"
                aria-label="Message"
              />
            </label>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small">Saved in DB via <span className="mono">/api/interviews/:id/messages</span></span>
              <button className="button buttonPrimary" disabled={sending} type="submit">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>

          {error ? <div className="error">{error}</div> : null}
        </div>
      </section>

      <aside className="card" aria-label="Feedback and score">
        <div className="cardInner stack">
          <h2 className="cardTitle">Feedback + score</h2>
          <p className="cardDesc">In the MVP, scoring is manual input stored to the DB.</p>

          <div className="stack">
            <label className="label">
              Score (optional)
              <input
                className="input"
                inputMode="numeric"
                pattern="[0-9]*"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="0 - 100"
              />
            </label>
            <label className="label">
              Notes
              <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <label className="label">
              Rubric (JSON)
              <textarea className="textarea mono" value={rubric} onChange={(e) => setRubric(e.target.value)} />
            </label>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="button buttonPrimary" type="button" onClick={saveFeedback} disabled={savingFeedback}>
                {savingFeedback ? 'Saving…' : 'Save feedback'}
              </button>
            </div>

            {feedbackSaved ? <div className="success">{feedbackSaved}</div> : null}
          </div>

          <hr className="hr" />

          <h3 style={{ margin: 0, fontSize: '1rem' }}>Previous feedback</h3>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {feedback.length ? (
              feedback.map((f) => (
                <li key={f.id} className="card" style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'none' }}>
                  <div className="cardInner stack" style={{ gap: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="badge">Score: {f.score ?? '—'}</span>
                      <span className="small mono">{new Date(f.created_at).toLocaleString()}</span>
                    </div>
                    {f.notes ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.notes}</p> : null}
                    {f.rubric && Object.keys(f.rubric).length ? (
                      <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>
                        {JSON.stringify(f.rubric, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                </li>
              ))
            ) : (
              <li className="small">No feedback yet.</li>
            )}
          </ul>

          {/* Social Sharing for Interview Reports */}
          <hr className="hr" />
          <ShareReport 
            report={{
              id: props.sessionId,
              title: 'Interview Session',
              sessionId: props.sessionId,
              score: feedback[0]?.score ?? undefined,
              notes: feedback[0]?.notes ?? undefined,
              created_at: new Date().toISOString(),
            }}
          />
        </div>
      </aside>
    </div>
  );
}
