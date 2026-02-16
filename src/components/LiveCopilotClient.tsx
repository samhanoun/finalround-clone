'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './LiveCopilotClient.module.css';

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

type CopilotHistorySession = {
  id: string;
  title: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  started_at: string;
  stopped_at: string | null;
  consumed_minutes: number | null;
  created_at: string;
};

type CopilotSummary = {
  id: string;
  summary_type: string;
  content: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type CopilotEvent = {
  id: string;
  event_type: 'transcript' | 'suggestion' | 'system' | string;
  payload: Record<string, unknown>;
  created_at: string;
};

type CopilotSessionDetail = CopilotSession & {
  metadata?: Record<string, unknown> | null;
  duration_seconds?: number | null;
  created_at?: string;
  updated_at?: string;
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

function listOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function formatModeLabel(mode: string): string {
  const raw = mode.trim();
  if (!raw) return 'General';
  return `${raw[0].toUpperCase()}${raw.slice(1)}`;
}

function calculateDurationMinutes(startedAt?: string | null, stoppedAt?: string | null): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(stoppedAt ?? Date.now()).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
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
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<'live' | 'analytics'>('live');

  const [historySessions, setHistorySessions] = useState<CopilotHistorySession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<{ session: CopilotSessionDetail; events: CopilotEvent[]; summaries: CopilotSummary[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const streamRef = useRef<EventSource | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLite | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = session?.status === 'active';

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const markSessionExpired = useCallback(
    (message?: string, stoppedAt?: string | null) => {
      stopHeartbeat();
      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: 'expired',
              stopped_at: stoppedAt ?? prev.stopped_at,
            }
          : prev,
      );
      setError(message ?? 'Session expired due to inactivity. Start a new session to continue.');
    },
    [stopHeartbeat],
  );

  const startHeartbeat = useCallback(
    (sessionId: string) => {
      stopHeartbeat();

      const ping = async () => {
        try {
          const res = await fetch(`/api/copilot/sessions/${sessionId}/heartbeat`, { method: 'POST' });
          const json = (await res.json().catch(() => null)) as
            | { state?: string; message?: string; session?: { stopped_at?: string | null } }
            | null;

          if (res.status === 409 || json?.state === 'expired') {
            markSessionExpired(json?.message, json?.session?.stopped_at ?? null);
          }
        } catch {
          // Ignore transient heartbeat errors; stream can still recover on reconnect.
        }
      };

      void ping();
      heartbeatRef.current = setInterval(() => {
        void ping();
      }, 20_000);
    },
    [markSessionExpired, stopHeartbeat],
  );

  useEffect(() => {
    if (isActive && session?.id) {
      startHeartbeat(session.id);
      return;
    }

    stopHeartbeat();
  }, [isActive, session?.id, startHeartbeat, stopHeartbeat]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const res = await fetch('/api/copilot/sessions/history');
      const json = (await res.json().catch(() => ({}))) as { sessions?: CopilotHistorySession[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load session history');

      const nextSessions = Array.isArray(json.sessions) ? json.sessions : [];
      setHistorySessions(nextSessions);

      setSelectedHistoryId((prev) => {
        if (prev && nextSessions.some((item) => item.id === prev)) return prev;
        return nextSessions[0]?.id ?? null;
      });

      if (nextSessions.length === 0) {
        setHistoryDetail(null);
        setDetailError(null);
      }
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Failed to load session history');
      setHistorySessions([]);
      setSelectedHistoryId(null);
      setHistoryDetail(null);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadHistoryDetail = useCallback(async (sessionId: string) => {
    setDetailLoading(true);
    setDetailError(null);

    try {
      const res = await fetch(`/api/copilot/sessions/${sessionId}`);
      const json = (await res.json().catch(() => ({}))) as {
        session?: CopilotSessionDetail;
        events?: CopilotEvent[];
        summaries?: CopilotSummary[];
        error?: string;
      };
      if (!res.ok || !json.session) throw new Error(json.error ?? 'Failed to load session details');

      setHistoryDetail({
        session: json.session,
        events: Array.isArray(json.events) ? json.events : [],
        summaries: Array.isArray(json.summaries) ? json.summaries : [],
      });
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load session details');
      setHistoryDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activePanel !== 'analytics') return;
    void loadHistory();
  }, [activePanel, loadHistory]);

  useEffect(() => {
    if (activePanel !== 'analytics' || !selectedHistoryId) return;
    void loadHistoryDetail(selectedHistoryId);
  }, [activePanel, selectedHistoryId, loadHistoryDetail]);

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
      if (parsed.payload.status === 'expired') {
        markSessionExpired(undefined, parsed.payload.stopped_at);
      } else if (parsed.payload.status !== 'active') {
        stopHeartbeat();
      }
    });

    es.onerror = () => {
      setConnecting(false);
      setError('Live stream disconnected. Stop and restart the session to reconnect.');
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
      stopHeartbeat();
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
    if (!session?.id || submitting || summaryLoading) return;

    setError(null);
    setSummaryLoading(true);

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
      setSummaryLoading(false);
    }
  }

  const transcriptRows = useMemo(
    () =>
      transcript.map((item) => ({
        id: item.id,
        text: asText(item.payload.text, asText(item.payload.content, '')).trim(),
        speaker: asText(item.payload.speaker, 'speaker'),
        created_at: item.created_at,
      })),
    [transcript],
  );

  const suggestionRows = useMemo(
    () =>
      suggestions.map((item) => ({
        id: item.id,
        text: asText(item.payload.text, asText(item.payload.content, '')).trim(),
        category: asText(item.payload.category, 'suggestion'),
        followUp: asText(item.payload.follow_up, '').trim(),
        complexity: asText(item.payload.complexity, '').trim(),
        edgeCases: Array.isArray(item.payload.edge_cases)
          ? item.payload.edge_cases.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : [],
        checklist: Array.isArray(item.payload.checklist)
          ? item.payload.checklist.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          : [],
        talkingPoints: Array.isArray(item.payload.talking_points)
          ? item.payload.talking_points.filter((x): x is string => typeof x === 'string')
          : [],
        created_at: item.created_at,
      })),
    [suggestions],
  );

  const analyticsSummary = useMemo(() => {
    const codingStructuredTips = suggestionRows.filter((row) => row.complexity || row.edgeCases.length > 0 || row.checklist.length > 0).length;
    const withFollowUps = suggestionRows.filter((row) => row.followUp).length;

    return {
      transcriptLines: transcriptRows.length,
      suggestions: suggestionRows.length,
      codingStructuredTips,
      withFollowUps,
    };
  }, [suggestionRows, transcriptRows.length]);

  const selectedHistorySession = useMemo(
    () => historySessions.find((item) => item.id === selectedHistoryId) ?? null,
    [historySessions, selectedHistoryId],
  );

  const historyInsights = useMemo(() => {
    if (!historyDetail) {
      return {
        transcriptLines: 0,
        suggestions: 0,
        mode: 'General',
        durationMinutes: selectedHistorySession?.consumed_minutes ?? 0,
      };
    }

    const transcriptLines = historyDetail.events.filter((item) => item.event_type === 'transcript').length;
    const suggestionCount = historyDetail.events.filter((item) => item.event_type === 'suggestion').length;
    const modeValue = asText(historyDetail.session.metadata?.mode, asText(selectedHistorySession?.metadata?.mode, 'general'));

    const explicitMinutes = historyDetail.session.consumed_minutes;
    const durationFromSeconds = historyDetail.session.duration_seconds;

    const durationMinutes =
      typeof explicitMinutes === 'number' && explicitMinutes >= 0
        ? explicitMinutes
        : typeof durationFromSeconds === 'number' && durationFromSeconds >= 0
          ? Math.round(durationFromSeconds / 60)
          : calculateDurationMinutes(historyDetail.session.started_at, historyDetail.session.stopped_at);

    return {
      transcriptLines,
      suggestions: suggestionCount,
      mode: formatModeLabel(modeValue),
      durationMinutes,
    };
  }, [historyDetail, selectedHistorySession]);

  const latestSummary = useMemo(() => {
    if (!historyDetail?.summaries?.length) return null;
    return historyDetail.summaries[0];
  }, [historyDetail]);

  const latestSummaryPayload = useMemo(() => {
    return {
      strengths: listOfStrings(latestSummary?.payload?.strengths),
      weaknesses: listOfStrings(latestSummary?.payload?.weaknesses),
      nextSteps: listOfStrings(latestSummary?.payload?.next_steps),
    };
  }, [latestSummary]);

  const streamState = connecting ? 'Connecting…' : streamRef.current ? 'Connected' : 'Disconnected';

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card">
        <div className="cardInner stack" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="stack" style={{ gap: 4 }}>
              <h2 className="cardTitle">Live session controls</h2>
              <p className="small" style={{ margin: 0 }}>Start a focused session, then stream questions to get real-time guidance.</p>
            </div>
            <span className={`badge ${isActive ? styles.badgeActive : ''}`}>{isActive ? 'Running' : 'Idle'}</span>
          </div>

          <div className="grid2">
            <label className="label">
              Interview mode
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
              Session title
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior SWE at Acme"
                disabled={isActive || submitting}
              />
            </label>
          </div>

          <div className={styles.controlGrid}>
            <button className="button buttonPrimary" onClick={startSession} disabled={isActive || submitting} type="button">
              {submitting && !isActive ? 'Starting…' : 'Start session'}
            </button>
            <button className="button buttonDanger" onClick={stopSession} disabled={!isActive || submitting} type="button">
              {submitting && isActive ? 'Stopping…' : 'Stop session'}
            </button>
            <div className={styles.inlineMeta}>
              <span className="small">Stream</span>
              <span className="badge">{streamState}</span>
            </div>
          </div>

          {session ? (
            <p className="small mono" style={{ margin: 0 }}>
              Session {session.id.slice(0, 8)} · {session.status} · {new Date(session.started_at).toLocaleString()}
            </p>
          ) : (
            <p className="small" style={{ margin: 0 }}>No active session yet.</p>
          )}

          <div className={styles.composerCard}>
            <div className={styles.composerHeader}>
              <h3 className={styles.sectionTitle}>Transcript composer</h3>
              <span className="small">Mic {listening ? 'on' : 'off'}</span>
            </div>
            <div className={styles.composerControls}>
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
                {submitting && isActive ? 'Sending…' : 'Send line'}
              </button>
              <button className="button" type="button" onClick={listening ? stopListening : startListening} disabled={!isActive || submitting}>
                {listening ? 'Stop mic' : 'Start mic'}
              </button>
              <button className="button" type="button" onClick={generateSummary} disabled={!session || summaryLoading || submitting}>
                {summaryLoading ? 'Generating…' : 'Generate summary'}
              </button>
            </div>
            <textarea
              className="input"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Paste the latest question or answer here"
              rows={3}
              disabled={!isActive || submitting}
            />
          </div>

          {error ? <div className="error">{error}</div> : null}
        </div>
      </section>

      <section className="card" aria-label="Copilot view tabs">
        <div className="cardInner stack" style={{ gap: 10 }}>
          <div className={styles.tabRow} role="tablist" aria-label="Copilot views">
            <button
              className={`button ${activePanel === 'live' ? 'buttonPrimary' : ''}`}
              type="button"
              role="tab"
              aria-selected={activePanel === 'live'}
              onClick={() => setActivePanel('live')}
            >
              Live feed
            </button>
            <button
              className={`button ${activePanel === 'analytics' ? 'buttonPrimary' : ''}`}
              type="button"
              role="tab"
              aria-selected={activePanel === 'analytics'}
              onClick={() => setActivePanel('analytics')}
            >
              Analytics
            </button>
          </div>
          <p className="small" style={{ margin: 0 }}>
            {activePanel === 'live'
              ? 'Real-time transcript and suggestion stream.'
              : 'Review prior sessions, key metrics, and generated summaries.'}
          </p>
        </div>
      </section>

      {activePanel === 'live' ? (
        <>
          <div className="grid2" style={{ alignItems: 'start' }}>
            <section className="card" aria-label="Live transcript panel">
              <div className="cardInner stack" style={{ gap: 12 }}>
                <div className={styles.panelHeader}>
                  <h2 className="cardTitle">Transcript</h2>
                  <span className="small">{transcriptRows.length} lines</span>
                </div>
                {!isActive && transcriptRows.length === 0 ? <p className={styles.emptyState}>Start a session to capture transcript lines.</p> : null}
                {isActive && transcriptRows.length === 0 ? <p className={styles.emptyState}>Waiting for transcript input…</p> : null}
                <ol className={styles.feedList}>
                  {transcriptRows.map((row) => (
                    <li key={row.id} className={styles.feedCard}>
                      <div className={styles.feedMeta}>
                        <span className="badge">{row.speaker}</span>
                        <span className="small mono">{new Date(row.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className={styles.feedText}>{row.text}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </section>

            <section className="card" aria-label="Live suggestions panel">
              <div className="cardInner stack" style={{ gap: 12 }}>
                <div className={styles.panelHeader}>
                  <h2 className="cardTitle">Suggestions</h2>
                  <span className="small">{suggestionRows.length} tips</span>
                </div>
                {!isActive && suggestionRows.length === 0 ? (
                  <p className={styles.emptyState}>Start a session and send transcript lines to get suggestions.</p>
                ) : null}
                {isActive && suggestionRows.length === 0 ? (
                  <p className={styles.emptyState}>Suggestions will appear after transcript lines are sent.</p>
                ) : null}
                <ol className={styles.feedList}>
                  {suggestionRows.map((row) => (
                    <li key={row.id} className={styles.feedCard}>
                      <div className={styles.feedMeta}>
                        <span className="badge">{row.category}</span>
                        <span className="small mono">{new Date(row.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className={styles.feedText}>{row.text}</p>
                      {row.complexity ? (
                        <p className="small" style={{ margin: 0 }}>
                          <strong>Complexity:</strong> {row.complexity}
                        </p>
                      ) : null}
                      {row.edgeCases.length ? (
                        <div>
                          <p className="small" style={{ margin: '0 0 4px' }}>
                            <strong>Edge cases</strong>
                          </p>
                          <ul className={styles.pointsList}>
                            {row.edgeCases.map((edgeCase, idx) => (
                              <li key={`${row.id}-edge-${idx}`} className="small">
                                {edgeCase}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {row.checklist.length ? (
                        <div>
                          <p className="small" style={{ margin: '0 0 4px' }}>
                            <strong>Checklist</strong>
                          </p>
                          <ul className={styles.pointsList}>
                            {row.checklist.map((item, idx) => (
                              <li key={`${row.id}-check-${idx}`} className="small">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {row.talkingPoints.length ? (
                        <ul className={styles.pointsList}>
                          {row.talkingPoints.map((point, idx) => (
                            <li key={`${row.id}-point-${idx}`} className="small">
                              {point}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {row.followUp ? (
                        <p className="small" style={{ margin: 0 }}>
                          <strong>Follow-up:</strong> {row.followUp}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </div>

          <section className="card" aria-label="Session summary">
            <div className="cardInner stack" style={{ gap: 12 }}>
              <div className={styles.panelHeader}>
                <h2 className="cardTitle">Session summary</h2>
                {summaryLoading ? <span className="small">Generating…</span> : null}
              </div>

              {!summary && !summaryLoading ? (
                <p className={styles.emptyState}>Generate a summary once you have enough transcript context.</p>
              ) : null}

              {summaryLoading ? <p className={styles.emptyState}>Building strengths, weaknesses, and next steps…</p> : null}

              {summary ? (
                <>
                  {summary.content ? <p style={{ margin: 0 }}>{summary.content}</p> : null}
                  <div className="grid2" style={{ alignItems: 'start' }}>
                    <div>
                      <h3 className={styles.sectionTitle}>Strengths</h3>
                      <ul className={styles.pointsList}>
                        {summary.strengths.length ? (
                          summary.strengths.map((item, idx) => (
                            <li key={`strength-${idx}`} className="small">
                              {item}
                            </li>
                          ))
                        ) : (
                          <li className="small">No strengths identified yet.</li>
                        )}
                      </ul>
                    </div>
                    <div>
                      <h3 className={styles.sectionTitle}>Weaknesses</h3>
                      <ul className={styles.pointsList}>
                        {summary.weaknesses.length ? (
                          summary.weaknesses.map((item, idx) => (
                            <li key={`weakness-${idx}`} className="small">
                              {item}
                            </li>
                          ))
                        ) : (
                          <li className="small">No weaknesses identified yet.</li>
                        )}
                      </ul>
                    </div>
                  </div>
                  <div>
                    <h3 className={styles.sectionTitle}>Next steps</h3>
                    <ul className={styles.pointsList}>
                      {summary.next_steps.length ? (
                        summary.next_steps.map((item, idx) => (
                          <li key={`next-${idx}`} className="small">
                            {item}
                          </li>
                        ))
                      ) : (
                        <li className="small">No next steps identified yet.</li>
                      )}
                    </ul>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <section className="card" aria-label="Analytics history view">
          <div className="cardInner stack" style={{ gap: 14 }}>
            <h2 className="cardTitle">Copilot history</h2>

            <div className={styles.metricGrid}>
              <div className={styles.metricCard}><span className="small">Current transcript lines</span><strong>{analyticsSummary.transcriptLines}</strong></div>
              <div className={styles.metricCard}><span className="small">Current suggestions</span><strong>{analyticsSummary.suggestions}</strong></div>
              <div className={styles.metricCard}><span className="small">Selected session lines</span><strong>{historyInsights.transcriptLines}</strong></div>
              <div className={styles.metricCard}><span className="small">Selected session tips</span><strong>{historyInsights.suggestions}</strong></div>
            </div>

            <div className={styles.historyScaffold}>
              <aside className={styles.historyList} aria-label="Session history list">
                <div className={styles.panelHeader}>
                  <h3 className={styles.sectionTitle}>Recent sessions</h3>
                  <button className="button" type="button" onClick={() => void loadHistory()} disabled={historyLoading}>
                    {historyLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>

                {historyLoading ? <p className={styles.emptyState}>Loading session history…</p> : null}
                {historyError ? <div className="error">{historyError}</div> : null}
                {!historyLoading && !historyError && historySessions.length === 0 ? (
                  <p className={styles.emptyState}>No copilot sessions yet. Run a live session to build analytics history.</p>
                ) : null}

                {historySessions.length > 0 ? (
                  <ol className={styles.sessionList}>
                    {historySessions.map((item) => {
                      const modeValue = formatModeLabel(asText(item.metadata?.mode, 'general'));
                      const duration = typeof item.consumed_minutes === 'number'
                        ? item.consumed_minutes
                        : calculateDurationMinutes(item.started_at, item.stopped_at);

                      return (
                        <li key={item.id}>
                          <button
                            className={`${styles.sessionItemButton} ${selectedHistoryId === item.id ? styles.sessionItemButtonActive : ''}`}
                            type="button"
                            onClick={() => setSelectedHistoryId(item.id)}
                          >
                            <div className={styles.sessionItemTopRow}>
                              <strong className={styles.sessionItemTitle}>{item.title?.trim() || 'Untitled session'}</strong>
                              <span className="small mono">{new Date(item.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className={styles.chipRow}>
                              <span className="badge">{item.status}</span>
                              <span className="badge">{modeValue}</span>
                              <span className="badge">{duration} min</span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </aside>

              <section className={styles.historyDetail} aria-label="Session detail view">
                {!selectedHistoryId ? <p className={styles.emptyState}>Select a session to inspect detailed analytics.</p> : null}
                {selectedHistoryId && detailLoading ? <p className={styles.emptyState}>Loading session details…</p> : null}
                {selectedHistoryId && detailError ? (
                  <div className="stack" style={{ gap: 10 }}>
                    <div className="error">{detailError}</div>
                    <button className="button" type="button" onClick={() => void loadHistoryDetail(selectedHistoryId)}>
                      Retry loading details
                    </button>
                  </div>
                ) : null}

                {selectedHistorySession && historyDetail && !detailLoading && !detailError ? (
                  <div className="stack" style={{ gap: 12 }}>
                    <div className={styles.panelHeader}>
                      <h3 className={styles.sectionTitle} style={{ margin: 0 }}>{selectedHistorySession.title?.trim() || 'Untitled session'}</h3>
                      <span className="small mono">{new Date(selectedHistorySession.started_at).toLocaleString()}</span>
                    </div>

                    <div className={styles.chipRow}>
                      <span className="badge">{historyDetail.session.status}</span>
                      <span className="badge">{historyInsights.mode}</span>
                      <span className="badge">{historyInsights.durationMinutes} min</span>
                    </div>

                    <div className={styles.metricGrid}>
                      <div className={styles.metricCard}><span className="small">Transcript lines</span><strong>{historyInsights.transcriptLines}</strong></div>
                      <div className={styles.metricCard}><span className="small">Suggestions</span><strong>{historyInsights.suggestions}</strong></div>
                    </div>

                    <div className={styles.summaryCard}>
                      <div className={styles.panelHeader}>
                        <h4 className={styles.sectionTitle} style={{ margin: 0 }}>Latest summary</h4>
                        {latestSummary ? <span className="small mono">{new Date(latestSummary.updated_at).toLocaleString()}</span> : null}
                      </div>

                      {!latestSummary ? <p className={styles.emptyState}>No generated summary for this session yet.</p> : null}

                      {latestSummary ? (
                        <>
                          {latestSummary.content ? <p style={{ margin: 0 }}>{latestSummary.content}</p> : null}
                          <div className={styles.summaryColumns}>
                            <div>
                              <h5 className={styles.subSectionTitle}>Strengths</h5>
                              <ul className={styles.pointsList}>
                                {latestSummaryPayload.strengths.length > 0
                                  ? latestSummaryPayload.strengths.map((point, idx) => <li key={`hist-strength-${idx}`} className="small">{point}</li>)
                                  : <li className="small">No strengths captured.</li>}
                              </ul>
                            </div>
                            <div>
                              <h5 className={styles.subSectionTitle}>Weaknesses</h5>
                              <ul className={styles.pointsList}>
                                {latestSummaryPayload.weaknesses.length > 0
                                  ? latestSummaryPayload.weaknesses.map((point, idx) => <li key={`hist-weakness-${idx}`} className="small">{point}</li>)
                                  : <li className="small">No weaknesses captured.</li>}
                              </ul>
                            </div>
                          </div>
                          <div>
                            <h5 className={styles.subSectionTitle}>Next steps</h5>
                            <ul className={styles.pointsList}>
                              {latestSummaryPayload.nextSteps.length > 0
                                ? latestSummaryPayload.nextSteps.map((point, idx) => <li key={`hist-next-${idx}`} className="small">{point}</li>)
                                : <li className="small">No next steps captured.</li>}
                            </ul>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
