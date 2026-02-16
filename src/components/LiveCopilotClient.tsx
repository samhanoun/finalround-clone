'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLite {
  transcript: string;
}

interface SpeechRecognitionResultLite {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLite;
}

interface SpeechRecognitionEventLite extends Event {
  results: ArrayLike<SpeechRecognitionResultLite>;
}

interface SpeechRecognitionLite extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLite) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLite;


type CopilotMode = 'general' | 'coding' | 'phone' | 'video';

type CopilotSession = {
  id: string;
  status: 'active' | 'stopped' | 'expired' | string;
  title: string | null;
  started_at: string;
  stopped_at: string | null;
  consumed_minutes: number;
};

type CopilotEvent = {
  id: string;
  event_type: 'transcript' | 'suggestion' | 'system' | string;
  payload: Record<string, unknown>;
  created_at: string;
};

type StreamEnvelope<T> = {
  type: string;
  payload: T;
};

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseEnvelope<T>(raw: string): StreamEnvelope<T> | null {
  try {
    const parsed = JSON.parse(raw) as StreamEnvelope<T>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.type !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function LiveCopilotClient() {
  const [mode, setMode] = useState<CopilotMode>('general');
  const [title, setTitle] = useState('');
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [transcript, setTranscript] = useState<CopilotEvent[]>([]);
  const [suggestions, setSuggestions] = useState<CopilotEvent[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftSpeaker, setDraftSpeaker] = useState<'interviewer' | 'candidate'>('interviewer');
  const [listening, setListening] = useState(false);
  const [summary, setSummary] = useState<{ content: string; strengths: string[]; weaknesses: string[]; next_steps: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<EventSource | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLite | null>(null);

  const isActive = session?.status === 'active';

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  function connectStream(sessionId: string) {
    streamRef.current?.close();
    setConnecting(true);

    const es = new EventSource(`/api/copilot/sessions/${sessionId}/stream`);
    streamRef.current = es;

    es.addEventListener('connected', () => {
      setConnecting(false);
    });

    es.addEventListener('snapshot', (event) => {
      const parsed = parseEnvelope<{ session: CopilotSession; events: CopilotEvent[] }>((event as MessageEvent<string>).data);
      if (!parsed) return;

      setSession(parsed.payload.session);
      const allEvents = parsed.payload.events;
      setTranscript(allEvents.filter((item) => item.event_type === 'transcript'));
      setSuggestions(allEvents.filter((item) => item.event_type === 'suggestion'));
    });

    es.addEventListener('copilot_event', (event) => {
      const parsed = parseEnvelope<CopilotEvent>((event as MessageEvent<string>).data);
      if (!parsed) return;

      const next = parsed.payload;
      if (next.event_type === 'transcript') {
        setTranscript((prev) => [...prev, next]);
      } else if (next.event_type === 'suggestion') {
        setSuggestions((prev) => [...prev, next]);
      }
    });

    es.addEventListener('session', (event) => {
      const parsed = parseEnvelope<CopilotSession>((event as MessageEvent<string>).data);
      if (!parsed) return;
      setSession(parsed.payload);
    });

    es.onerror = () => {
      setConnecting(false);
      setError('Live stream disconnected. You can stop and restart the session.');
    };
  }

  async function startSession() {
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    setTranscript([]);
    setSuggestions([]);
    setSummary(null);

    try {
      const res = await fetch('/api/copilot/sessions/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || `Live ${mode} session`,
          metadata: {
            mode,
            beta: true,
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { session?: CopilotSession; error?: string };
      if (!res.ok || !json.session) throw new Error(json.error ?? 'Failed to start session');

      setSession(json.session);
      connectStream(json.session.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start session');
    } finally {
      setSubmitting(false);
    }
  }

  async function stopSession() {
    if (!session?.id || submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/copilot/sessions/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { session?: CopilotSession; error?: string };
      if (!res.ok || !json.session) throw new Error(json.error ?? 'Failed to stop session');

      setSession(json.session);
      streamRef.current?.close();
      streamRef.current = null;
      setConnecting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop session');
    } finally {
      setSubmitting(false);
    }
  }

  function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') return null;

    const withSpeech = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };

    return withSpeech.SpeechRecognition ?? withSpeech.webkitSpeechRecognition ?? null;
  }

  function startListening() {
    if (!session?.id || !isActive) return;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError('Browser speech recognition not supported. Use manual transcript input.');
      return;
    }

    setError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let finalText = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const alt = result[0];
        if (result.isFinal && alt?.transcript) {
          finalText += `${alt.transcript} `;
        }
      }

      const cleaned = finalText.trim();
      if (cleaned) {
        setDraftText(cleaned);
      }
    };

    recognition.onerror = () => {
      setError('Mic transcription failed. You can continue with manual input.');
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  async function submitTranscriptEvent() {
    if (!session?.id || !draftText.trim() || submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/copilot/sessions/${session.id}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType: 'transcript',
          speaker: draftSpeaker,
          text: draftText.trim(),
          autoSuggest: true,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to submit transcript event');
      setDraftText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit transcript event');
    } finally {
      setSubmitting(false);
    }
  }

  async function generateSummary() {
    if (!session?.id || submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/copilot/sessions/${session.id}/summarize`, {
        method: 'POST',
      });

      const json = (await res.json().catch(() => ({}))) as {
        summary?: { content?: string; payload?: { strengths?: string[]; weaknesses?: string[]; next_steps?: string[] } };
        error?: string;
      };

      if (!res.ok || !json.summary) throw new Error(json.error ?? 'Failed to generate summary');

      setSummary({
        content: json.summary.content ?? '',
        strengths: Array.isArray(json.summary.payload?.strengths) ? json.summary.payload.strengths : [],
        weaknesses: Array.isArray(json.summary.payload?.weaknesses) ? json.summary.payload.weaknesses : [],
        next_steps: Array.isArray(json.summary.payload?.next_steps) ? json.summary.payload.next_steps : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate summary');
    } finally {
      setSubmitting(false);
    }
  }

  const transcriptRows = useMemo(
    () => transcript.map((item) => ({
      id: item.id,
      text: asText(item.payload.text, asText(item.payload.content, '')),
      speaker: asText(item.payload.speaker, 'speaker'),
      created_at: item.created_at,
    })),
    [transcript],
  );

  const suggestionRows = useMemo(
    () => suggestions.map((item) => ({
      id: item.id,
      text: asText(item.payload.text, asText(item.payload.content, '')),
      category: asText(item.payload.category, 'suggestion'),
      followUp: asText(item.payload.follow_up, ''),
      talkingPoints: Array.isArray(item.payload.talking_points)
        ? item.payload.talking_points.filter((x): x is string => typeof x === 'string')
        : [],
      created_at: item.created_at,
    })),
    [suggestions],
  );

  return (
    <div className="stack">
      <section className="card">
        <div className="cardInner stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="cardTitle">Live session controls</h2>
            <span className="badge">{isActive ? 'Running' : 'Idle'}</span>
          </div>

          <div className="grid2">
            <label className="label">
              Mode
              <select
                className="select"
                value={mode}
                onChange={(e) => setMode(e.target.value as CopilotMode)}
                disabled={isActive || submitting}
              >
                <option value="general">General interview</option>
                <option value="coding">Coding interview</option>
                <option value="phone">Phone screen</option>
                <option value="video">Video call</option>
              </select>
            </label>

            <label className="label">
              Session title (optional)
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Senior SWE @ Acme"
                disabled={isActive || submitting}
              />
            </label>
          </div>

          <div className="row">
            <button className="button buttonPrimary" onClick={startSession} disabled={isActive || submitting} type="button">
              {submitting && !isActive ? 'Starting…' : 'Start session'}
            </button>
            <button className="button buttonDanger" onClick={stopSession} disabled={!isActive || submitting} type="button">
              {submitting && isActive ? 'Stopping…' : 'Stop session'}
            </button>
            <span className="small">SSE: {connecting ? 'connecting…' : streamRef.current ? 'connected' : 'disconnected'}</span>
          </div>

          {session ? (
            <p className="small mono" style={{ margin: 0 }}>
              Session {session.id} · status={session.status} · started={new Date(session.started_at).toLocaleString()}
            </p>
          ) : null}

          <div className="stack" style={{ gap: 10 }}>
            <div className="row">
              <select
                className="select"
                value={draftSpeaker}
                onChange={(e) => setDraftSpeaker(e.target.value as 'interviewer' | 'candidate')}
                disabled={!isActive || submitting}
                aria-label="Transcript speaker"
              >
                <option value="interviewer">Interviewer</option>
                <option value="candidate">Candidate</option>
              </select>
              <button
                className="button"
                type="button"
                onClick={submitTranscriptEvent}
                disabled={!isActive || !draftText.trim() || submitting}
              >
                Send transcript line
              </button>
              <button className="button" type="button" onClick={listening ? stopListening : startListening} disabled={!isActive || submitting}>
                {listening ? 'Stop mic' : 'Start mic'}
              </button>
              <button className="button" type="button" onClick={generateSummary} disabled={!session || submitting}>
                Generate summary
              </button>
            </div>
            <textarea
              className="input"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Paste interviewer question or transcript line here..."
              rows={3}
              disabled={!isActive || submitting}
            />
            <span className="small">Mic: {listening ? 'listening… (finalized speech fills textbox)' : 'off'}</span>
          </div>

          {error ? <div className="error">{error}</div> : null}
        </div>
      </section>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <section className="card" aria-label="Live transcript panel">
          <div className="cardInner stack">
            <h2 className="cardTitle">Transcript</h2>
            <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 420, overflow: 'auto' }}>
              {transcriptRows.length ? transcriptRows.map((row) => (
                <li key={row.id} className="card" style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'none' }}>
                  <div className="cardInner stack" style={{ gap: 6 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="badge">{row.speaker}</span>
                      <span className="small mono">{new Date(row.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{row.text || '—'}</p>
                  </div>
                </li>
              )) : <li className="small">No transcript events yet.</li>}
            </ol>
          </div>
        </section>

        <section className="card" aria-label="Live suggestions panel">
          <div className="cardInner stack">
            <h2 className="cardTitle">Suggestions</h2>
            <ol className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 420, overflow: 'auto' }}>
              {suggestionRows.length ? suggestionRows.map((row) => (
                <li key={row.id} className="card" style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'none' }}>
                  <div className="cardInner stack" style={{ gap: 6 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="badge">{row.category}</span>
                      <span className="small mono">{new Date(row.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{row.text || '—'}</p>
                    {row.talkingPoints.length ? (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {row.talkingPoints.map((point, idx) => (
                          <li key={`${row.id}-point-${idx}`} className="small">{point}</li>
                        ))}
                      </ul>
                    ) : null}
                    {row.followUp ? <p className="small" style={{ margin: 0 }}><strong>Follow-up:</strong> {row.followUp}</p> : null}
                  </div>
                </li>
              )) : <li className="small">No suggestion events yet.</li>}
            </ol>
          </div>
        </section>
      </div>

      {summary ? (
        <section className="card" aria-label="Session summary">
          <div className="cardInner stack">
            <h2 className="cardTitle">Session summary</h2>
            <p style={{ margin: 0 }}>{summary.content || '—'}</p>
            <div className="grid2" style={{ alignItems: 'start' }}>
              <div>
                <h3 className="small" style={{ marginTop: 0 }}>Strengths</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {summary.strengths.length ? summary.strengths.map((item, idx) => (
                    <li key={`strength-${idx}`} className="small">{item}</li>
                  )) : <li className="small">No strengths recorded yet.</li>}
                </ul>
              </div>
              <div>
                <h3 className="small" style={{ marginTop: 0 }}>Weaknesses</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {summary.weaknesses.length ? summary.weaknesses.map((item, idx) => (
                    <li key={`weakness-${idx}`} className="small">{item}</li>
                  )) : <li className="small">No weaknesses recorded yet.</li>}
                </ul>
              </div>
            </div>
            <div>
              <h3 className="small" style={{ marginTop: 0 }}>Next steps</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {summary.next_steps.length ? summary.next_steps.map((item, idx) => (
                  <li key={`next-${idx}`} className="small">{item}</li>
                )) : <li className="small">No next steps recorded yet.</li>}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
