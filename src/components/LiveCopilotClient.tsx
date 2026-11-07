'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import styles from './LiveCopilotClient.module.css';
import { formatCopilotActionError } from './liveCopilotDataControls';
import { sloClient, SLO_TYPE_OVERLAY_INTERACTION, SLO_TYPE_TRANSCRIPT_TO_SUGGESTION, getStatusEmoji, formatLatency, type SLOCompliance, type SLOMetric } from '@/lib/sloClient';
import { AudioSourcesPanel } from './copilot/AudioSourcesPanel';
import { useMeetingSettings } from './copilot/useMeetingSettings';
import { detectMeetingPlatform, meetingUrl } from '@/lib/meetingSettings';
import { useAudioCapture } from './copilot/useAudioCapture';
import { useLiveTranscription } from './copilot/useLiveTranscription';
import { useVoiceSample } from './copilot/useVoiceSample';
import { useCopilotAnswers } from './copilot/useCopilotAnswers';
import { AnswerPanel } from './copilot/AnswerPanel';
import { AutoEndNotice } from './copilot/AutoEndNotice';
import { MeetingEndedNotice, MeetingStartedNotice } from './copilot/MeetingNotices';
import { LatencyDrawer, LatencyTable } from './copilot/LatencyDrawer';
import { isLatencyPayload, summarizeLatencyEvents } from '@/lib/copilot/latency';
import { grabScreenFrame, screenSignature } from '@/lib/copilot/screenFrame';
import { AutoScreenWatcher } from '@/lib/copilot/autoScreen';
import { onDesktopCommand, onDesktopMeeting, withAnswerWindowHidden } from '@/lib/desktop';
import type { ConnectionState, TailLine } from './copilot/AnswerView';
import { FeedsSection, type FeedLayout } from './copilot/LiveFeeds';
import { SessionBar } from './copilot/SessionBar';
import {
  SessionSetup,
  loadSavedSetup,
  saveSetup,
  setupStartBody,
  type CopilotMode,
  type SessionSetupValue,
} from './copilot/SessionSetup';
import type { Utterance } from '@/lib/stt/utterances';
import { ChevronDownIcon, CloseIcon, MicIcon, ScreenIcon } from './icons';

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

type TranscriptChunkInput = {
  speaker: 'interviewer' | 'candidate' | 'system';
  text: string;
  isFinal: boolean;
  interimId?: string;
  clientTimestamp?: string;
  autoSuggest?: boolean;
};

type TranscriptIngestionResponse = {
  events?: CopilotEvent[];
  suggestions?: CopilotEvent[];
  accepted?: number;
  error?: string;
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

type HiringSignal = 'strong_no_hire' | 'no_hire' | 'lean_no_hire' | 'lean_hire' | 'hire' | 'strong_hire';
type RubricKey = 'communication' | 'technical_accuracy' | 'problem_solving' | 'structure' | 'ownership' | 'role_fit';

type ReportDimensionView = {
  score: number | null;
  evidence: string;
  recommendation: string;
};

type ReportViewModel = {
  overallScore: number | null;
  hiringSignal: HiringSignal | null;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  nextSteps: string[];
  rubric: Record<RubricKey, ReportDimensionView>;
  source: 'api' | 'legacy';
};

const RUBRIC_KEYS: RubricKey[] = ['communication', 'technical_accuracy', 'problem_solving', 'structure', 'ownership', 'role_fit'];

function defaultRubric(): Record<RubricKey, ReportDimensionView> {
  return {
    communication: { score: null, evidence: '', recommendation: '' },
    technical_accuracy: { score: null, evidence: '', recommendation: '' },
    problem_solving: { score: null, evidence: '', recommendation: '' },
    structure: { score: null, evidence: '', recommendation: '' },
    ownership: { score: null, evidence: '', recommendation: '' },
    role_fit: { score: null, evidence: '', recommendation: '' },
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
}

function asScore(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asRubricScore(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function asHiringSignal(value: unknown): HiringSignal | null {
  return value === 'strong_no_hire' || value === 'no_hire' || value === 'lean_no_hire' || value === 'lean_hire' || value === 'hire' || value === 'strong_hire'
    ? value
    : null;
}

function asPercent(value: number | null, max: number): number {
  if (value === null || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function parseReportPayload(payload: unknown): Omit<ReportViewModel, 'source'> | null {
  const root = asObject(payload);
  const nested = asObject(root.report);
  const source = Object.keys(nested).length > 0 ? nested : root;

  const rubric = defaultRubric();
  const rubricInput = asObject(source.rubric);
  for (const key of RUBRIC_KEYS) {
    const dim = asObject(rubricInput[key]);
    rubric[key] = {
      score: asRubricScore(dim.score),
      evidence: asText(dim.evidence, ''),
      recommendation: asText(dim.recommendation, ''),
    };
  }

  const summary = asText(source.summary, '');
  const strengths = listOfStrings(source.strengths ?? root.strengths);
  const weaknesses = listOfStrings(source.weaknesses ?? root.weaknesses);
  const nextSteps = listOfStrings(source.next_steps ?? root.next_steps);
  const overallScore = asScore(source.overall_score ?? root.overall_score);
  const hiringSignal = asHiringSignal(source.hiring_signal ?? root.hiring_signal);

  const hasMeaningfulContent =
    summary.length > 0 || strengths.length > 0 || weaknesses.length > 0 || nextSteps.length > 0 || overallScore !== null || hiringSignal !== null;

  if (!hasMeaningfulContent) return null;

  return {
    summary,
    strengths,
    weaknesses,
    nextSteps,
    overallScore,
    hiringSignal,
    rubric,
  };
}

function appendUniqueEvents(current: CopilotEvent[], incoming: CopilotEvent[]): CopilotEvent[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((item) => item.id));
  const additions = incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  if (additions.length === 0) return current;
  return [...current, ...additions];
}

/** Why a session ended; stored on the session by the stop route. */
type StopReason = 'user' | 'tab_closed' | 'sharing_stopped';

/** Typed to confirm deleting all copilot data; the purge route checks it, so it stays the same in every language. */
const PURGE_PHRASE = 'DELETE ALL COPILOT DATA';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** An answer on one flowing line for a preview: no source marks, points joined by middle dots. */
function previewText(text: string): string {
  return text
    .replace(/\s*\[S\d+\]/g, '')
    .replace(/\n\s*[-*•]\s+/g, ' · ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

function calculateDurationMinutes(startedAt?: string | null, stoppedAt?: string | null): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(stoppedAt ?? Date.now()).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/**
 * A disclosure row: the heading holds the button (its name), with one line on
 * what it's for as its description. The whole row is clickable.
 */
function ToolToggle({
  open,
  onToggle,
  controls,
  name,
  description,
  level = 3,
  headingId,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  name: string;
  description: string;
  level?: 2 | 3;
  headingId?: string;
}) {
  const descriptionId = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={styles.toolRow}>
      <Heading id={headingId} className={styles.toolHeading}>
        <button
          type="button"
          className={styles.toolToggle}
          aria-expanded={open}
          aria-controls={controls}
          aria-describedby={descriptionId}
          onClick={onToggle}
        >
          <ChevronDownIcon size={16} className={styles.chevron} />
          {name}
        </button>
      </Heading>
      <p id={descriptionId} className={styles.toolDesc}>
        {description}
      </p>
    </div>
  );
}

function PointList({ items, empty }: { items: string[]; empty: string }) {
  return (
    <ul className={styles.pointsList}>
      {items.length > 0 ? items.map((item, idx) => <li key={idx}>{item}</li>) : <li className={styles.muted}>{empty}</li>}
    </ul>
  );
}

export function LiveCopilotClient({
  initialGoalId = null,
  debug = false,
  onSessionChange,
}: {
  initialGoalId?: string | null;
  /** `?debug=1`: latency, diagnostics and the event stream's state, for support. */
  debug?: boolean;
  /** Tells the page frame when a session starts or ends (phones hide the tab bar during one). */
  onSessionChange?: (active: boolean) => void;
} = {}) {
  const t = useTranslations('Copilot');
  const tSetup = useTranslations('SessionSetup');
  const tErrors = useTranslations('CopilotErrors');
  const tAnswer = useTranslations('Answer');
  const tAudio = useTranslations('AudioSources');
  const format = useFormatter();
  const modeLabel = (mode: string) => {
    const raw = mode.trim() || 'general';
    return t.has(`modes.${raw}`) ? t(`modes.${raw}`) : `${raw[0].toUpperCase()}${raw.slice(1)}`;
  };
  const statusLabel = (status: string) => (t.has(`statuses.${status}`) ? t(`statuses.${status}`) : status);
  // The page renders only on the client (inside RequireAuth), so reading storage here is safe.
  const [setup, setSetup] = useState<SessionSetupValue>(loadSavedSetup);
  const [session, setSession] = useState<CopilotSession | null>(null);
  const [transcript, setTranscript] = useState<CopilotEvent[]>([]);
  const [suggestions, setSuggestions] = useState<CopilotEvent[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftSpeaker, setDraftSpeaker] = useState<'interviewer' | 'candidate'>('interviewer');
  const audio = useAudioCapture();
  // Settings → Meeting apps: share steps, the meeting link, auto start, auto end and the microphone.
  const meeting = useMeetingSettings();
  const audioStart = audio.start;
  // Phone / in-person mode: one microphone, no screen share (the setup is fixed while a session runs).
  const singleMic = setup.singleMic;
  const startListening = useCallback(
    () => audioStart({ useMicrophone: meeting.useMicrophone, singleMic }),
    [audioStart, meeting.useMicrophone, singleMic],
  );
  const voiceSample = useVoiceSample(audio);
  const [micSyncing, setMicSyncing] = useState(false);
  const [streamOpen, setStreamOpen] = useState(false);
  const [lastMicSyncAt, setLastMicSyncAt] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ content: string; strengths: string[]; weaknesses: string[]; next_steps: string[] } | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [liveLayout, setLiveLayout] = useState<FeedLayout>('split');
  // Secondary tools: Type a line and Session summary open on demand.
  const [composerOpen, setComposerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);

  // Desktop app: a meeting app started (offer to start) or stopped (count down to the end) using the microphone.
  const [meetingStarted, setMeetingStarted] = useState<{ app: string } | null>(null);
  const [meetingEnded, setMeetingEnded] = useState<{ app: string; at: number; sessionId: string } | null>(null);

  const [historySessions, setHistorySessions] = useState<CopilotHistorySession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyModeFilter, setHistoryModeFilter] = useState<'all' | CopilotMode>('all');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<{ session: CopilotSessionDetail; events: CopilotEvent[]; summaries: CopilotSummary[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [historyReport, setHistoryReport] = useState<ReportViewModel | null>(null);
  const [historyReportLoading, setHistoryReportLoading] = useState(false);
  const [historyReportError, setHistoryReportError] = useState<string | null>(null);
  const [historyReportCopied, setHistoryReportCopied] = useState(false);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [exportingAllData, setExportingAllData] = useState(false);
  const [deleteAllPending, setDeleteAllPending] = useState(false);
  const [deleteAllConfirmation, setDeleteAllConfirmation] = useState('');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);

  // Overlay controls for T4: hide/show, mute, timer (support diagnostics, ?debug=1)
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayMuted, setOverlayMuted] = useState(false);
  const [overlayTimerRunning, setOverlayTimerRunning] = useState(false);
  const [overlayTimerSeconds, setOverlayTimerSeconds] = useState(0);

  // Performance instrumentation for T4: interaction latency tracking
  const [interactionLatency, setInteractionLatency] = useState<{ action: string; latencyMs: number | null }>({ action: '', latencyMs: null });

  // SLO compliance tracking - stored in refs for use in event handlers before render
  const sloComplianceRef = useRef<SLOCompliance[]>([]);
  const recentSloMetricsRef = useRef<SLOMetric[]>([]);

  // SLO compliance state for UI display
  const [sloCompliance, setSloCompliance] = useState<SLOCompliance[]>([]);
  const [recentSloMetrics, setRecentSloMetrics] = useState<SLOMetric[]>([]);

  // Helper to update SLO compliance (both refs and state)
  const updateSLOCompliance = useCallback(() => {
    const compliance = sloClient.getAllCompliance();
    const metrics = sloClient.getRecentMetrics();
    sloComplianceRef.current = compliance;
    recentSloMetricsRef.current = metrics;
    setSloCompliance(compliance);
    setRecentSloMetrics(metrics);
  }, []);

  // Transcript timestamps for latency tracking
  const transcriptTimestampsRef = useRef<Map<string, number>>(new Map());

  const streamRef = useRef<EventSource | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptQueueRef = useRef<TranscriptChunkInput[]>([]);
  const transcriptFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptFlushInFlightRef = useRef(false);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // One stop at a time, whoever asks (the button, a countdown, the desktop app).
  const stoppingRef = useRef(false);

  const isActive = session?.status === 'active';
  const currentSessionId = session?.id ?? null;

  useEffect(() => {
    onSessionChange?.(isActive);
  }, [isActive, onSessionChange]);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      transcriptQueueRef.current = [];
      if (transcriptFlushTimeoutRef.current) {
        clearTimeout(transcriptFlushTimeoutRef.current);
        transcriptFlushTimeoutRef.current = null;
      }
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
      setError(message ?? t('errors.expired'));
    },
    [stopHeartbeat, t],
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
      if (!res.ok) throw new Error(t('errors.historyFailed'));

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
      setHistoryError(e instanceof Error ? e.message : t('errors.historyFailed'));
      setHistorySessions([]);
      setSelectedHistoryId(null);
      setHistoryDetail(null);
    } finally {
      setHistoryLoading(false);
    }
  }, [t]);

  // Bumped by the Retry button to fetch the selected session's detail again.
  const [detailReload, setDetailReload] = useState(0);
  const retryHistoryDetail = () => {
    setDetailLoading(true);
    setDetailError(null);
    setDetailReload((n) => n + 1);
  };

  /** Past sessions open on demand; opening them loads the list. */
  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    setSettingsError(null);
    setSettingsSuccess(null);
    if (next) void loadHistory();
  }

  // detailLoading is set when the selection changes (render-time block next to
  // filteredHistorySessions) or by Retry; this only fetches.
  useEffect(() => {
    if (!historyOpen || !selectedHistoryId) return;

    const loadDetail = async () => {
      try {
        const res = await fetch(`/api/copilot/sessions/${selectedHistoryId}`);
        const json = (await res.json().catch(() => ({}))) as {
          session?: CopilotSessionDetail;
          events?: CopilotEvent[];
          summaries?: CopilotSummary[];
          error?: string;
        };
        if (!res.ok || !json.session) throw new Error(t('errors.detailFailed'));

        setHistoryDetail({
          session: json.session,
          events: Array.isArray(json.events) ? json.events : [],
          summaries: Array.isArray(json.summaries) ? json.summaries : [],
        });
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : t('errors.detailFailed'));
        setHistoryDetail(null);
      } finally {
        setDetailLoading(false);
      }
    };

    void loadDetail();
  }, [historyOpen, selectedHistoryId, detailReload, t]);

  // T4: Timer effect for overlay countdown
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (overlayTimerRunning) {
      intervalId = setInterval(() => {
        setOverlayTimerSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [overlayTimerRunning]);

  // T4: Hotkeys for the diagnostics overlay controls. Support only (?debug=1),
  // so Ctrl+H, Ctrl+T and Esc keep their usual meaning for everyone else.
  useEffect(() => {
    if (!debug) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ctrl/Cmd + H: Toggle overlay visibility
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        const start = performance.now();
        setOverlayVisible((prev) => {
          const end = performance.now();
          const latencyMs = Math.round(end - start);
          setInteractionLatency({ action: 'toggleOverlay', latencyMs });
          // Record to SLO client
          sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, 'toggleOverlay', latencyMs);
          updateSLOCompliance();

          return !prev;
        });
        return;
      }

      // Ctrl/Cmd + M: Toggle mute
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const start = performance.now();
        setOverlayMuted((prev) => {
          const end = performance.now();
          const latencyMs = Math.round(end - start);
          setInteractionLatency({ action: 'toggleMute', latencyMs });
          // Record to SLO client
          sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, 'toggleMute', latencyMs);
          updateSLOCompliance();

          return !prev;
        });
        return;
      }

      // Ctrl/Cmd + T: Toggle timer
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        const start = performance.now();
        setOverlayTimerRunning((prev) => {
          const end = performance.now();
          const latencyMs = Math.round(end - start);
          setInteractionLatency({ action: 'toggleTimer', latencyMs });
          // Record to SLO client
          sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, 'toggleTimer', latencyMs);
          updateSLOCompliance();

          return !prev;
        });
        return;
      }

      // Escape: Hide overlay
      if (e.key === 'Escape' && overlayVisible) {
        e.preventDefault();
        const start = performance.now();
        setOverlayVisible(false);
        const end = performance.now();
        const latencyMs = Math.round(end - start);
        setInteractionLatency({ action: 'hideOverlay', latencyMs });
        // Record to SLO client
        sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, 'hideOverlay', latencyMs);
        updateSLOCompliance();

        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [debug, overlayVisible, updateSLOCompliance]);

  // The legacy-summary fallback and loading flag are set when the inputs change
  // (render-time block next to filteredHistorySessions); this only fetches.
  useEffect(() => {
    if (!historyOpen || !selectedHistoryId) return;

    let cancelled = false;

    const loadReport = async () => {
      try {
        const res = await fetch(`/api/copilot/sessions/${selectedHistoryId}/report`);
        const json = (await res.json().catch(() => ({}))) as { report?: unknown; error?: string };

        if (!res.ok) {
          if (res.status === 404) return;
          throw new Error(t('errors.reportFailed'));
        }

        const parsed = parseReportPayload(json.report);
        if (cancelled) return;

        if (parsed) {
          setHistoryReport({ ...parsed, source: 'api' });
        }
      } catch (e) {
        if (cancelled) return;
        setHistoryReportError(e instanceof Error ? e.message : t('errors.reportFailed'));
      } finally {
        if (!cancelled) setHistoryReportLoading(false);
      }
    };

    void loadReport();

    return () => {
      cancelled = true;
    };
  }, [historyOpen, selectedHistoryId, historyDetail, t]);

  function connectStream(sessionId: string) {
    streamRef.current?.close();
    setConnecting(true);

    const es = new EventSource(`/api/copilot/sessions/${sessionId}/stream`);
    streamRef.current = es;
    setStreamOpen(true);

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
      // The same event can also arrive in a POST response; keep one copy.
      if (next.event_type === 'transcript') {
        setTranscript((prev) => appendUniqueEvents(prev, [next]));
      } else if (next.event_type === 'suggestion') {
        setSuggestions((prev) => appendUniqueEvents(prev, [next]));
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
      setError(t('errors.streamDisconnected'));
    };
  }

  async function startSession() {
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    setTranscript([]);
    setSuggestions([]);
    setSummary(null);
    setSummaryError(null);
    setLastMicSyncAt(null);

    try {
      const res = await fetch('/api/copilot/sessions/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // T10's "no full code" guardrail is part of the setup and goes in the session metadata.
        body: JSON.stringify(
          setupStartBody(setup, {
            at: (role, company) => tSetup('titleAt', { role, company }),
            fallback: (mode) => tSetup('titleDefault', { mode: tSetup(`modes.${mode}`) }),
          }),
        ),
      });
      const json = (await res.json().catch(() => ({}))) as { session?: CopilotSession; error?: string };
      if (!res.ok || !json.session) {
        throw new Error(json.error && t.has(`startErrors.${json.error}`) ? t(`startErrors.${json.error}`) : t('errors.startFailed'));
      }

      setSession(json.session);
      setMeetingStarted(null);
      connectStream(json.session.id);
      // Still inside the Start session click, so the share prompt is allowed.
      if (meeting.autoStartListening) void startListening();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.startFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Ends the session. `force` is for countdowns that ran out: they end it even
   * while a typed line is being sent, instead of leaving it running.
   */
  async function stopSession(reason: StopReason = 'user', { force = false }: { force?: boolean } = {}) {
    if (!session?.id || stoppingRef.current || (submitting && !force)) return;

    stoppingRef.current = true;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/copilot/sessions/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, reason }),
      });
      const json = (await res.json().catch(() => ({}))) as { session?: CopilotSession; error?: string };
      if (!res.ok || !json.session) throw new Error(t('errors.stopFailed'));

      setSession(json.session);
      setMeetingEnded(null);
      // An open Past sessions list still shows this session as active.
      if (historyOpen) void loadHistory();
      streamRef.current?.close();
      streamRef.current = null;
      setStreamOpen(false);
      stopHeartbeat();
      setConnecting(false);
      transcriptQueueRef.current = [];
      if (transcriptFlushTimeoutRef.current) {
        clearTimeout(transcriptFlushTimeoutRef.current);
        transcriptFlushTimeoutRef.current = null;
      }
      setMicSyncing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.stopFailed'));
    } finally {
      stoppingRef.current = false;
      setSubmitting(false);
    }
  }

  const flushTranscriptQueue = useCallback(async () => {
    if (!currentSessionId || !isActive) return;
    if (transcriptFlushInFlightRef.current) return;

    const queue = transcriptQueueRef.current;
    if (queue.length === 0) return;

    transcriptFlushInFlightRef.current = true;
    setMicSyncing(true);

    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, 8);
        // Track submission time for SLO
        const submitTime = Date.now();

        const res = await fetch(`/api/copilot/sessions/${currentSessionId}/transcript`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chunks: batch }),
        });

        const json = (await res.json().catch(() => ({}))) as TranscriptIngestionResponse;
        if (!res.ok) {
          queue.unshift(...batch);
          throw new Error(t('errors.syncFailed'));
        }

        setTranscript((prev) => appendUniqueEvents(prev, Array.isArray(json.events) ? json.events : []));
        setSuggestions((prev) => appendUniqueEvents(prev, Array.isArray(json.suggestions) ? json.suggestions : []));

        // Track transcript-to-suggestion latency for mic input
        if (Array.isArray(json.suggestions) && json.suggestions.length > 0) {
          const latency = Date.now() - submitTime;
          if (latency > 0) {
            sloClient.recordMetric(SLO_TYPE_TRANSCRIPT_TO_SUGGESTION, 'micToSuggestion', latency);
            updateSLOCompliance();
          }
        }

        setLastMicSyncAt(new Date().toISOString());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.syncFailed'));
    } finally {
      transcriptFlushInFlightRef.current = false;
      setMicSyncing(false);
    }
  }, [currentSessionId, isActive, updateSLOCompliance, t]);

  const enqueueTranscriptChunk = useCallback(
    (chunk: TranscriptChunkInput) => {
      transcriptQueueRef.current.push(chunk);

      if (transcriptFlushTimeoutRef.current) {
        clearTimeout(transcriptFlushTimeoutRef.current);
      }

      transcriptFlushTimeoutRef.current = setTimeout(() => {
        transcriptFlushTimeoutRef.current = null;
        void flushTranscriptQueue();
      }, 450);
    },
    [flushTranscriptQueue],
  );

  // Answers stream into the Current question card; saved answers reach the
  // suggestions list through the session stream.
  const answers = useCopilotAnswers({ sessionId: isActive && session ? session.id : null });

  // Every finished utterance is saved as it is; the question gate decides
  // which interviewer lines get an answer.
  const observeUtterance = answers.observe;
  const handleUtterance = useCallback(
    (utterance: Utterance) => {
      enqueueTranscriptChunk({
        speaker: utterance.role,
        text: utterance.text,
        isFinal: true,
        autoSuggest: false,
        clientTimestamp: new Date(utterance.completedAt).toISOString(),
      });
      observeUtterance(utterance);
    },
    [enqueueTranscriptChunk, observeUtterance],
  );

  const transcription = useLiveTranscription({
    sessionId: isActive && session ? session.id : null,
    capture: audio,
    onUtterance: handleUtterance,
    speakers: singleMic ? voiceSample.resolver : null,
  });

  const addTypedLine = answers.addTypedLine;
  const stopAnswer = answers.stop;
  const requestAnswerNow = answers.answerNow;
  const interviewerCaption = transcription.captions.interviewer;
  const answerNow = useCallback(() => {
    if (!requestAnswerNow(interviewerCaption)) {
      setError(t('errors.noQuestion'));
    }
  }, [interviewerCaption, requestAnswerNow, t]);

  // Solve screen reads the tab or screen already shared for audio: no second
  // prompt. The desktop app's floating answer window steps aside for the grab.
  const getDisplayVideoTrack = audio.getDisplayVideoTrack;
  const answerScreen = answers.answerScreen;
  const solveScreen = useCallback(async () => {
    const track = getDisplayVideoTrack();
    if (!track) {
      setError(t('errors.shareFirst'));
      return;
    }
    try {
      const frame = await withAnswerWindowHidden(async () => grabScreenFrame(track));
      if (!answerScreen(frame)) setError(t('errors.startFirst'));
    } catch {
      setError(t('errors.screenFailed'));
    }
  }, [getDisplayVideoTrack, answerScreen, t]);

  // Automatic Solve screen (on by default in coding interviews): a new screen is solved once it holds still.
  const [autoScreenChoice, setAutoScreenChoice] = useState<boolean | null>(null);
  const autoScreen = autoScreenChoice ?? setup.mode === 'coding';
  const autoWatcher = useRef(new AutoScreenWatcher());
  const listening = audio.status === 'live';
  useEffect(() => {
    if (!autoScreen || !isActive || !listening || singleMic) return;
    let cancelled = false;
    let running = false;
    const timer = window.setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const track = getDisplayVideoTrack();
        if (!track) return;
        const signature = await screenSignature(track);
        const busy = answers.getState().status === 'answering';
        if (!cancelled && autoWatcher.current.feed(signature, Date.now(), busy)) void solveScreen();
      } catch {
        // Sharing ended or the frame wasn't ready; the next tick tries again.
      } finally {
        running = false;
      }
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [autoScreen, isActive, listening, singleMic, getDisplayVideoTrack, answers, solveScreen]);

  // Desktop app shortcuts (Ctrl+Shift+A / S) work while the meeting app has focus.
  useEffect(() => {
    if (!isActive) return;
    return onDesktopCommand((command) => {
      if (command === 'answer-now') answerNow();
      else if (command === 'solve-screen') void solveScreen();
    });
  }, [isActive, answerNow, solveScreen]);

  // Desktop app meeting detection. "ended" during a session starts a short
  // countdown to its end; "started" with no session offers to start one.
  const activeSessionId = isActive && session ? session.id : null;
  const activeSessionRef = useRef<string | null>(null);
  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);
  useEffect(
    () =>
      onDesktopMeeting((event) => {
        const sessionId = activeSessionRef.current;
        if (event.state === 'started') {
          setMeetingEnded(null);
          setMeetingStarted(sessionId ? null : { app: event.app });
        } else {
          setMeetingStarted(null);
          setMeetingEnded(sessionId ? { app: event.app, at: Date.now(), sessionId } : null);
        }
      }),
    [],
  );

  useEffect(() => {
    saveSetup(setup);
  }, [setup]);

  // Closing the tab ends the session (and its billed minutes) instead of
  // leaving it to expire. A beacon still goes out while the page unloads.
  useEffect(() => {
    if (!activeSessionId) return;
    const onPageHide = () => {
      const body = new Blob([JSON.stringify({ sessionId: activeSessionId, reason: 'tab_closed' })], {
        type: 'application/json',
      });
      navigator.sendBeacon?.('/api/copilot/sessions/stop', body);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [activeSessionId]);

  // Stopping the meeting share starts a countdown to end the session (see AutoEndNotice).
  const [keepOpenAfterStop, setKeepOpenAfterStop] = useState<number | null>(null);
  const sharingStoppedAt =
    isActive && audio.status !== 'live' && audio.ended?.source === 'interviewer' ? audio.ended.at : null;

  // The panel's Start listening uses the microphone setting too.
  const captureForPanel = useMemo(() => ({ ...audio, start: startListening }), [audio, startListening]);
  const shareGuide = useMemo(() => {
    const link = meeting.askForLink ? meetingUrl(setup.meetingUrl) : null;
    const linkPlatform = link ? detectMeetingPlatform(link.href) : null;
    return {
      platform: linkPlatform ?? meeting.platform,
      // A Meet link always runs in the browser; Zoom and Teams follow the setting.
      desktopApp: linkPlatform === 'google_meet' ? false : meeting.desktopApp,
      useMicrophone: meeting.useMicrophone,
      meetingLink: link?.href,
    };
  }, [meeting, setup.meetingUrl]);

  const connection = useMemo<ConnectionState>(() => {
    if (audio.status !== 'live') {
      return { label: audio.status === 'starting' ? t('connection.startingAudio') : t('connection.notListening'), tone: 'off' };
    }
    if (transcription.status === 'live') return { label: t('connection.live'), tone: 'live' };
    if (transcription.status === 'error') return { label: t('connection.stopped'), tone: 'off' };
    return { label: transcription.status === 'reconnecting' ? t('connection.reconnecting') : t('connection.connecting'), tone: 'warn' };
  }, [audio.status, transcription.status, t]);

  // A flush still in flight when the session ends clears micSyncing itself;
  // until then the badge reads it only while the session is active.
  useEffect(() => {
    if (!isActive || !currentSessionId) {
      transcriptQueueRef.current = [];
      if (transcriptFlushTimeoutRef.current) {
        clearTimeout(transcriptFlushTimeoutRef.current);
        transcriptFlushTimeoutRef.current = null;
      }
      return;
    }

    if (transcriptQueueRef.current.length > 0) {
      void flushTranscriptQueue();
    }
  }, [flushTranscriptQueue, isActive, currentSessionId]);

  // Release the mic and the shared tab as soon as the session stops or expires.
  const stopAudio = audio.stop;
  useEffect(() => {
    if (!isActive) stopAudio();
  }, [isActive, stopAudio]);

  const submitTranscriptEvent = useCallback(async () => {
    if (!currentSessionId || !draftText.trim() || submitting) return;

    setError(null);
    setSubmitting(true);

    // Track transcript submission time for SLO measurement
    const transcriptSubmitTime = Date.now();

    try {
      const res = await fetch(`/api/copilot/sessions/${currentSessionId}/transcript`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chunks: [
            {
              speaker: draftSpeaker,
              text: draftText.trim(),
              isFinal: true,
              clientTimestamp: new Date().toISOString(),
            },
          ],
        }),
      });

      const json = (await res.json().catch(() => ({}))) as TranscriptIngestionResponse;
      if (!res.ok) throw new Error(t('errors.submitFailed'));

      const submitTimeKey = `submit-${transcriptSubmitTime}`;
      transcriptTimestampsRef.current.set(submitTimeKey, transcriptSubmitTime);

      setTranscript((prev) => appendUniqueEvents(prev, Array.isArray(json.events) ? json.events : []));
      setSuggestions((prev) => appendUniqueEvents(prev, Array.isArray(json.suggestions) ? json.suggestions : []));

      // Track transcript-to-suggestion latency if suggestions arrived
      if (Array.isArray(json.suggestions) && json.suggestions.length > 0) {
        const suggestionArrivalTime = Date.now();
        const latency = suggestionArrivalTime - transcriptSubmitTime;
        if (latency > 0) {
          sloClient.recordMetric(SLO_TYPE_TRANSCRIPT_TO_SUGGESTION, 'transcriptSubmitToSuggestion', latency);
          updateSLOCompliance();
        }
      }

      setLastMicSyncAt(new Date().toISOString());
      setDraftText('');
      // Typed interviewer lines are always answered; typed candidate lines add context.
      addTypedLine(draftSpeaker, draftText.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [addTypedLine, currentSessionId, draftSpeaker, draftText, submitting, updateSLOCompliance, t]);

  /** Start or stop listening; from a click or a key, which the share prompt needs. */
  const audioStatus = audio.status;
  const toggleListening = useCallback(() => {
    if (audioStatus === 'live') stopAudio();
    else if (audioStatus !== 'starting') void startListening();
  }, [audioStatus, stopAudio, startListening]);

  // Ctrl/Cmd+K opens Type a line; the field is focused once it's on screen.
  useEffect(() => {
    if (composerFocusRequest > 0) draftTextareaRef.current?.focus();
  }, [composerFocusRequest]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!session?.id || !isActive || submitting) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'enter') {
        event.preventDefault();
        void submitTranscriptEvent();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        // The keypress counts as the user gesture the screen-share prompt needs.
        toggleListening();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setComposerOpen(true);
        setComposerFocusRequest((n) => n + 1);
      }

      // A = Answer now and Esc = stop the answer, unless the user is typing.
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault();
          answerNow();
        } else if (event.key === 'Escape') {
          stopAnswer();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [answerNow, isActive, session?.id, stopAnswer, submitTranscriptEvent, submitting, toggleListening]);

  /** Fills Type a line with a sentence you can say to buy a few seconds while you think. */
  function insertBuyTimeLine() {
    setDraftSpeaker('candidate');
    setDraftText(t('fillerLine'));
    draftTextareaRef.current?.focus();
  }

  async function copyReportSnapshot() {
    if (!historyReport || typeof navigator === 'undefined' || !navigator.clipboard) return;

    const payload = {
      overallScore: historyReport.overallScore,
      hiringSignal: historyReport.hiringSignal,
      summary: historyReport.summary,
      strengths: historyReport.strengths,
      weaknesses: historyReport.weaknesses,
      nextSteps: historyReport.nextSteps,
      rubric: historyReport.rubric,
    };

    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setHistoryReportCopied(true);
    window.setTimeout(() => setHistoryReportCopied(false), 1800);
  }

  async function generateSummary() {
    if (!session?.id || submitting || summaryLoading) return;

    setSummaryError(null);
    setSummaryLoading(true);

    try {
      const res = await fetch(`/api/copilot/sessions/${session.id}/summarize`, {
        method: 'POST',
      });

      const json = (await res.json().catch(() => ({}))) as {
        summary?: { content?: string; payload?: { strengths?: string[]; weaknesses?: string[]; next_steps?: string[] } };
        error?: string;
      };

      if (!res.ok || !json.summary) throw new Error(t('errors.summaryFailed'));

      setSummary({
        content: json.summary.content ?? '',
        strengths: Array.isArray(json.summary.payload?.strengths) ? json.summary.payload.strengths : [],
        weaknesses: Array.isArray(json.summary.payload?.weaknesses) ? json.summary.payload.weaknesses : [],
        next_steps: Array.isArray(json.summary.payload?.next_steps) ? json.summary.payload.next_steps : [],
      });
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : t('errors.summaryFailed'));
    } finally {
      setSummaryLoading(false);
    }
  }

  async function deleteSelectedHistorySession() {
    if (!selectedHistorySession || deletingHistoryId) return;

    const displayName = selectedHistorySession.title?.trim() || t('untitled');
    const confirmation = window.prompt(t('history.deletePrompt', { name: displayName }));
    if (confirmation !== 'DELETE') return;

    setDeleteError(null);
    setDeleteSuccess(null);
    setDeletingHistoryId(selectedHistorySession.id);

    try {
      const res = await fetch(`/api/copilot/sessions/${selectedHistorySession.id}`, {
        method: 'DELETE',
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; extra?: { requestId?: string } };
      if (!res.ok || !json.ok) throw new Error(formatCopilotActionError(json, t('errors.deleteFailed'), tErrors));

      setHistoryDetail(null);
      setHistoryReport(null);
      setHistoryReportError(null);
      setDeleteSuccess(t('history.deleted', { name: displayName }));
      await loadHistory();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t('errors.deleteFailed'));
    } finally {
      setDeletingHistoryId(null);
    }
  }

  async function exportAllCopilotData() {
    if (exportingAllData || deleteAllPending) return;

    setSettingsError(null);
    setSettingsSuccess(null);
    setExportingAllData(true);

    try {
      const res = await fetch('/api/copilot/sessions/export');
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string; extra?: { requestId?: string } };
        throw new Error(formatCopilotActionError(json, t('errors.exportFailed'), tErrors));
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition') ?? '';
      const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      const filename = fileNameMatch?.[1] ?? `copilot-data-export-${new Date().toISOString().slice(0, 10)}.json`;

      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);

      setSettingsSuccess(t('data.exported'));
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : t('errors.exportFailed'));
    } finally {
      setExportingAllData(false);
    }
  }

  async function deleteAllCopilotData() {
    if (deleteAllPending || exportingAllData) return;

    if (isActive) {
      setSettingsError(t('errors.stopBeforePurge'));
      return;
    }

    if (deleteAllConfirmation !== PURGE_PHRASE) {
      setSettingsError(t('errors.typeConfirm', { phrase: PURGE_PHRASE }));
      return;
    }

    setSettingsError(null);
    setSettingsSuccess(null);
    setDeleteAllPending(true);

    try {
      const res = await fetch('/api/copilot/sessions/purge', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: deleteAllConfirmation }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        deleted?: { sessions?: number; events?: number; summaries?: number };
        error?: string;
        extra?: { requestId?: string };
      };
      if (!res.ok || !json.ok) throw new Error(formatCopilotActionError(json, t('errors.purgeFailed'), tErrors));

      setSession(null);
      setTranscript([]);
      setSuggestions([]);
      setSummary(null);
      setHistorySessions([]);
      setSelectedHistoryId(null);
      setHistoryDetail(null);
      setHistoryReport(null);
      setHistoryReportError(null);
      setDeleteAllConfirmation('');

      setSettingsSuccess(
        t('data.purged', {
          sessions: json.deleted?.sessions ?? 0,
          events: json.deleted?.events ?? 0,
          summaries: json.deleted?.summaries ?? 0,
        }),
      );

      await loadHistory();
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : t('errors.purgeFailed'));
    } finally {
      setDeleteAllPending(false);
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

  const answerTail = useMemo<TailLine[]>(() => {
    const said = transcriptRows
      .filter((row) => row.speaker === 'interviewer' || row.speaker === 'candidate')
      .slice(-4)
      .map((row) => ({ speaker: row.speaker as TailLine['speaker'], text: row.text }));
    const speaking: TailLine[] = [];
    if (transcription.captions.interviewer) speaking.push({ speaker: 'interviewer', text: transcription.captions.interviewer, live: true });
    if (transcription.captions.candidate) speaking.push({ speaker: 'candidate', text: transcription.captions.candidate, live: true });
    return [...said, ...speaking].slice(-5);
  }, [transcriptRows, transcription.captions]);

  const suggestionRows = useMemo(
    () =>
      suggestions.map((item) => ({
        id: item.id,
        text: asText(item.payload.text, asText(item.payload.content, '')).trim(),
        category: asText(item.payload.category, 'suggestion'),
        question: asText(item.payload.question, '').trim(),
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

  const filteredHistorySessions = useMemo(() => {
    const normalizedQuery = historyQuery.trim().toLowerCase();

    return historySessions.filter((item) => {
      const mode = asText(item.metadata?.mode, 'general') as CopilotMode | string;
      if (historyModeFilter !== 'all' && mode !== historyModeFilter) return false;

      if (!normalizedQuery) return true;

      const inTitle = (item.title ?? '').toLowerCase().includes(normalizedQuery);
      const inStatus = item.status.toLowerCase().includes(normalizedQuery);
      const inMode = mode.toLowerCase().includes(normalizedQuery);
      return inTitle || inStatus || inMode;
    });
  }, [historyModeFilter, historyQuery, historySessions]);

  const selectedHistorySession = historySessions.find((item) => item.id === selectedHistoryId) ?? null;

  // Keep the selection inside the filtered list.
  if (selectedHistoryId && !filteredHistorySessions.some((item) => item.id === selectedHistoryId)) {
    setSelectedHistoryId(filteredHistorySessions[0]?.id ?? null);
  }

  // Reset history state when the section opens or closes, or the selection or
  // loaded detail changes (React's "adjust state when inputs change" pattern).
  // The effects above only fetch the detail and the report.
  const [historyInputs, setHistoryInputs] = useState({ open: historyOpen, id: selectedHistoryId, detail: historyDetail });
  if (historyInputs.open !== historyOpen || historyInputs.id !== selectedHistoryId || historyInputs.detail !== historyDetail) {
    const idChanged = historyInputs.id !== selectedHistoryId;
    const viewChanged = idChanged || historyInputs.open !== historyOpen;
    const viewing = historyOpen && selectedHistoryId !== null;
    setHistoryInputs({ open: historyOpen, id: selectedHistoryId, detail: historyDetail });

    if (idChanged) {
      setDeleteError(null);
      setDeleteSuccess(null);
    }
    if (viewChanged && viewing) {
      setDetailLoading(true);
      setDetailError(null);
    }

    if (!viewing) {
      setHistoryReport(null);
      setHistoryReportLoading(false);
    } else {
      const fallbackSummary =
        historyDetail?.session?.id === selectedHistoryId
          ? historyDetail.summaries.find((item) => item.summary_type === 'mock_interview_report') ?? historyDetail.summaries[0] ?? null
          : null;
      const fallbackReport = fallbackSummary ? parseReportPayload(fallbackSummary.payload) : null;
      setHistoryReport(fallbackReport ? { ...fallbackReport, source: 'legacy' } : null);
      setHistoryReportLoading(true);
    }
    setHistoryReportError(null);
    setHistoryReportCopied(false);
  }

  const historyInsights = useMemo(() => {
    if (!historyDetail) {
      return {
        transcriptLines: 0,
        suggestions: 0,
        mode: 'general',
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
      mode: modeValue,
      durationMinutes,
    };
  }, [historyDetail, selectedHistorySession]);

  const historyEventBreakdown = useMemo(() => {
    if (!historyDetail) {
      return { transcripts: [], suggestions: [], systems: [], latency: summarizeLatencyEvents([]) } as {
        transcripts: CopilotEvent[];
        suggestions: CopilotEvent[];
        systems: CopilotEvent[];
        latency: ReturnType<typeof summarizeLatencyEvents>;
      };
    }

    return {
      transcripts: historyDetail.events.filter((item) => item.event_type === 'transcript'),
      suggestions: historyDetail.events.filter((item) => item.event_type === 'suggestion'),
      systems: historyDetail.events.filter(
        (item) => item.event_type !== 'transcript' && item.event_type !== 'suggestion' && !isLatencyPayload(item.payload),
      ),
      latency: summarizeLatencyEvents(historyDetail.events.map((item) => item.payload)),
    };
  }, [historyDetail]);

  const streamState = connecting ? 'connecting' : streamOpen ? 'connected' : 'disconnected';
  const hasSavedLines = transcriptRows.length > 0 || suggestionRows.length > 0;
  // The transcript, answers and tools exist once there's a session: during it, or after it with lines to read.
  const showFeeds = isActive || (session !== null && hasSavedLines);
  const showMeetingEnded = isActive && session !== null && meetingEnded !== null && meetingEnded.sessionId === session.id;
  const showAutoEnd = sharingStoppedAt !== null && meeting.endWhenSharingStops && keepOpenAfterStop !== sharingStoppedAt;
  const listenLabel = audio.status === 'live' ? tAudio('stop') : audio.status === 'starting' ? tAudio('starting') : tAudio('start');

  return (
    <div className={`${styles.page} ${isActive ? styles.inSession : ''}`}>
      {isActive && session ? (
        <SessionBar session={session} streamState={streamState} onStop={() => void stopSession()} stopping={submitting} debug={debug} />
      ) : null}

      {!isActive && meetingStarted ? (
        <MeetingStartedNotice
          app={meetingStarted.app}
          onStart={() => void startSession()}
          onDismiss={() => setMeetingStarted(null)}
          starting={submitting}
        />
      ) : null}

      {!isActive ? (
        <SessionSetup
          value={setup}
          onChange={setSetup}
          onStart={startSession}
          starting={submitting}
          askForLink={meeting.askForLink}
          autoStartListening={meeting.autoStartListening}
          initialGoalId={initialGoalId}
          error={error}
        />
      ) : null}

      {isActive ? (
        <section className={styles.liveGrid} aria-label={t('liveAssistance')}>
          {showMeetingEnded || showAutoEnd || error ? (
            <div className={styles.notices}>
              {showMeetingEnded && meetingEnded ? (
                <MeetingEndedNotice
                  key={meetingEnded.at}
                  app={meetingEnded.app}
                  startedAt={meetingEnded.at}
                  onExpire={() => void stopSession('user', { force: true })}
                  onKeepGoing={() => setMeetingEnded(null)}
                  onEndNow={() => void stopSession()}
                  ending={submitting}
                />
              ) : null}
              {showAutoEnd && sharingStoppedAt !== null ? (
                <AutoEndNotice
                  key={sharingStoppedAt}
                  startedAt={sharingStoppedAt}
                  onExpire={() => void stopSession('sharing_stopped', { force: true })}
                  onKeepOpen={() => setKeepOpenAfterStop(sharingStoppedAt)}
                />
              ) : null}
              {error ? (
                <div className={`error ${styles.sessionError}`} role="status" aria-live="polite">
                  <span>{error}</span>
                  <button type="button" className={styles.dismiss} onClick={() => setError(null)} aria-label={t('dismissError')}>
                    <CloseIcon size={16} />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className={styles.answerCol}>
            <AnswerPanel
              answers={answers}
              onAnswerNow={answerNow}
              // Nothing is shared in phone mode, so there is no screen to solve.
              onSolveScreen={singleMic ? undefined : solveScreen}
              screenDisabled={audio.status !== 'live'}
              disabled={!isActive}
              connection={connection}
              tail={answerTail}
              autoScreen={{ on: autoScreen, onToggle: setAutoScreenChoice }}
              mobileBar
            />
          </div>
          <div className={styles.rail}>
            <AudioSourcesPanel
              capture={captureForPanel}
              transcription={transcription}
              disabled={!isActive}
              share={shareGuide}
              voiceSample={singleMic ? voiceSample : undefined}
              mobileBar
            />
            {debug ? <LatencyDrawer answers={answers} /> : null}
          </div>
        </section>
      ) : null}

      {showFeeds ? (
        <FeedsSection
          title={isActive ? t('layout.title') : t('lastSession', { title: session?.title?.trim() || t('untitled') })}
          layout={liveLayout}
          onLayout={setLiveLayout}
          transcript={transcriptRows}
          suggestions={suggestionRows}
          isActive={isActive}
        />
      ) : null}

      {showFeeds ? (
        <section className={`card ${styles.tools}`} aria-labelledby="copilot-tools-title">
          <h2 id="copilot-tools-title" className={styles.toolsTitle}>
            {t('tools.title')}
          </h2>

          {isActive ? (
            <div className={styles.tool}>
              <ToolToggle
                open={composerOpen}
                onToggle={() => setComposerOpen((open) => !open)}
                controls="copilot-composer"
                name={t('composer.title')}
                description={t('tools.composerDesc')}
              />
              {composerOpen ? (
                <div id="copilot-composer" className={styles.toolBody}>
                  <textarea
                    ref={draftTextareaRef}
                    className="textarea"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    placeholder={t('composer.placeholder')}
                    aria-label={t('composer.title')}
                    rows={3}
                    disabled={!isActive || submitting}
                  />
                  <div className={styles.composerRow}>
                    <select
                      className={`select ${styles.speakerSelect}`}
                      value={draftSpeaker}
                      onChange={(e) => setDraftSpeaker(e.target.value as 'interviewer' | 'candidate')}
                      disabled={!isActive || submitting}
                      aria-label={t('composer.speaker')}
                    >
                      <option value="interviewer">{t('interviewer')}</option>
                      <option value="candidate">{t('composer.candidate')}</option>
                    </select>
                    <button className="button" type="button" onClick={submitTranscriptEvent} disabled={!isActive || !draftText.trim() || submitting}>
                      {submitting && isActive ? t('composer.sending') : t('composer.send')}
                    </button>
                    <button className="button buttonGhost" type="button" onClick={insertBuyTimeLine} disabled={!isActive || submitting}>
                      {t('composer.filler')}
                    </button>
                    <span className={styles.syncState}>
                      {micSyncing && isActive ? t('composer.syncing') : t('composer.synced')}
                      {lastMicSyncAt ? (
                        <time className={styles.syncTime} dateTime={lastMicSyncAt}>
                          {format.dateTime(new Date(lastMicSyncAt), { timeStyle: 'medium' })}
                        </time>
                      ) : null}
                    </span>
                  </div>
                  <p className={styles.shortcuts}>{t.rich('composer.shortcuts', { kbd: (chunks) => <kbd>{chunks}</kbd> })}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={styles.tool}>
            <ToolToggle
              open={summaryOpen}
              onToggle={() => setSummaryOpen((open) => !open)}
              controls="copilot-summary"
              name={t('summary.title')}
              description={t('tools.summaryDesc')}
            />
            {summaryOpen ? (
              <div id="copilot-summary" className={styles.toolBody} aria-busy={summaryLoading}>
                {summaryLoading ? <p className={styles.toolNote}>{t('summary.building')}</p> : null}
                {!summary && !summaryLoading ? <p className={styles.toolNote}>{t('summary.empty')}</p> : null}
                {summary ? (
                  <div className={styles.summary}>
                    {summary.content ? <p className={styles.summaryText}>{summary.content}</p> : null}
                    <div className={styles.summaryColumns}>
                      <div>
                        <h3 className={styles.subTitle}>{t('report.strengths')}</h3>
                        <PointList items={summary.strengths} empty={t('summary.noStrengths')} />
                      </div>
                      <div>
                        <h3 className={styles.subTitle}>{t('report.weaknesses')}</h3>
                        <PointList items={summary.weaknesses} empty={t('summary.noWeaknesses')} />
                      </div>
                    </div>
                    <div>
                      <h3 className={styles.subTitle}>{t('report.nextSteps')}</h3>
                      <PointList items={summary.next_steps} empty={t('summary.noNextSteps')} />
                    </div>
                  </div>
                ) : null}
                {summaryError ? (
                  <div className="error" role="status" aria-live="polite">
                    {summaryError}
                  </div>
                ) : null}
                <div>
                  <button className="button" type="button" onClick={generateSummary} disabled={!session || summaryLoading || submitting}>
                    {summaryLoading ? t('generating') : summary ? t('summary.again') : t('composer.summarize')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className={`card ${styles.history}`} aria-labelledby="copilot-history-title">
        <ToolToggle
          open={historyOpen}
          onToggle={toggleHistory}
          controls="copilot-history"
          name={t('history.sectionTitle')}
          description={t('history.sectionDesc')}
          level={2}
          headingId="copilot-history-title"
        />
        {historyOpen ? (
          <div id="copilot-history" className={styles.historyBody}>
            <div className={styles.historyGrid}>
              <div className={styles.historyList} role="group" aria-label={t('history.listLabel')}>
                <div className={styles.listHeader}>
                  <h3 className={styles.subTitle}>{t('history.recent')}</h3>
                  <button className="button buttonSmall buttonGhost" type="button" onClick={() => void loadHistory()} disabled={historyLoading}>
                    {historyLoading ? t('history.refreshing') : t('history.refresh')}
                  </button>
                </div>

                <div className={styles.filters}>
                  <label className="label">
                    {t('history.search')}
                    <input
                      className="input"
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                      placeholder={t('history.searchPlaceholder')}
                    />
                  </label>
                  <label className="label">
                    {t('history.mode')}
                    <select className="select" value={historyModeFilter} onChange={(e) => setHistoryModeFilter(e.target.value as 'all' | CopilotMode)}>
                      <option value="all">{t('history.allModes')}</option>
                      {(['general', 'coding', 'phone', 'video'] as const).map((value) => (
                        <option key={value} value={value}>
                          {t(`modeOptions.${value}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {historyLoading ? <p className={styles.quietState}>{t('history.loading')}</p> : null}
                {historyError ? <div className="error">{historyError}</div> : null}
                {!historyLoading && !historyError && historySessions.length === 0 ? <p className={styles.quietState}>{t('history.empty')}</p> : null}
                {!historyLoading && !historyError && historySessions.length > 0 && filteredHistorySessions.length === 0 ? (
                  <p className={styles.quietState}>{t('history.noMatches')}</p>
                ) : null}

                {filteredHistorySessions.length > 0 ? (
                  <ol className={styles.sessionList}>
                    {filteredHistorySessions.map((item) => {
                      const duration =
                        typeof item.consumed_minutes === 'number' ? item.consumed_minutes : calculateDurationMinutes(item.started_at, item.stopped_at);

                      return (
                        <li key={item.id}>
                          <button
                            className={styles.sessionItem}
                            type="button"
                            aria-pressed={selectedHistoryId === item.id}
                            onClick={() => setSelectedHistoryId(item.id)}
                          >
                            <span className={styles.sessionTop}>
                              <span className={styles.sessionTitle}>{item.title?.trim() || t('untitled')}</span>
                              <time className={styles.sessionDate} dateTime={item.created_at}>
                                {format.dateTime(new Date(item.created_at), { dateStyle: 'medium' })}
                              </time>
                            </span>
                            <span className={styles.dotted}>
                              <span>{statusLabel(item.status)}</span>
                              <span>{modeLabel(asText(item.metadata?.mode, 'general'))}</span>
                              <span>{t('minutes', { count: duration })}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </div>

              <section className={styles.historyDetail} aria-label={t('history.detailLabel')}>
                {!selectedHistoryId ? <p className={styles.quietState}>{t('history.selectOne')}</p> : null}
                {selectedHistoryId && detailLoading ? <p className={styles.quietState}>{t('history.loadingDetail')}</p> : null}
                {selectedHistoryId && detailError ? (
                  <div className={styles.detailBlock}>
                    <div className="error">{detailError}</div>
                    <div>
                      <button className="button" type="button" onClick={retryHistoryDetail}>
                        {t('history.retry')}
                      </button>
                    </div>
                  </div>
                ) : null}

                {selectedHistorySession && historyDetail && !detailLoading && !detailError ? (
                  <>
                    <div className={styles.detailHeader}>
                      <div className={styles.detailHeading}>
                        <h3 className={styles.detailTitle}>{selectedHistorySession.title?.trim() || t('untitled')}</h3>
                        <p className={styles.dotted}>
                          <time dateTime={selectedHistorySession.started_at}>
                            {format.dateTime(new Date(selectedHistorySession.started_at), { dateStyle: 'medium', timeStyle: 'short' })}
                          </time>
                          <span>{statusLabel(historyDetail.session.status)}</span>
                          <span>{modeLabel(historyInsights.mode)}</span>
                          <span>{t('minutes', { count: historyInsights.durationMinutes })}</span>
                        </p>
                      </div>
                      <button
                        className="button buttonSmall buttonDanger"
                        type="button"
                        onClick={() => void deleteSelectedHistorySession()}
                        disabled={deletingHistoryId === selectedHistorySession.id}
                      >
                        {deletingHistoryId === selectedHistorySession.id ? t('history.deleting') : t('history.delete')}
                      </button>
                    </div>

                    {deleteError ? (
                      <div className="error" role="status" aria-live="polite">
                        {deleteError}
                      </div>
                    ) : null}
                    {deleteSuccess ? (
                      <div className="success" role="status" aria-live="polite">
                        {deleteSuccess}
                      </div>
                    ) : null}

                    <dl className={styles.stats}>
                      <div>
                        <dt>{t('history.lines')}</dt>
                        <dd>{historyInsights.transcriptLines}</dd>
                      </div>
                      <div>
                        <dt>{t('history.suggestions')}</dt>
                        <dd>{historyInsights.suggestions}</dd>
                      </div>
                      {debug ? (
                        <div>
                          <dt>{t('history.systemEvents')}</dt>
                          <dd>{historyEventBreakdown.systems.length}</dd>
                        </div>
                      ) : null}
                    </dl>

                    {debug && historyEventBreakdown.latency.turns > 0 ? (
                      <LatencyTable
                        summary={historyEventBreakdown.latency.stages}
                        caption={t('history.latencyCaption', {
                          answered: historyEventBreakdown.latency.outcomes.answered,
                          replaced: historyEventBreakdown.latency.outcomes.superseded,
                          failed: historyEventBreakdown.latency.outcomes.error,
                        })}
                      />
                    ) : null}

                    <div className={styles.recentGrid}>
                      <div className={styles.recent}>
                        <div className={styles.listHeader}>
                          <h4 className={styles.subTitle}>{t('history.recentTranscript')}</h4>
                          <span className={styles.meta}>{t('history.last5')}</span>
                        </div>
                        <ol className={styles.recentList}>
                          {historyEventBreakdown.transcripts
                            .slice(-5)
                            .reverse()
                            .map((event) => {
                              const interviewer = asText(event.payload.speaker) === 'interviewer';
                              return (
                                <li key={`transcript-preview-${event.id}`} data-voice={interviewer ? 'interviewer' : 'you'}>
                                  <span className={styles.voiceLabel}>{interviewer ? t('interviewer') : t('you')}</span>
                                  <span>{asText(event.payload.text, asText(event.payload.content, '—'))}</span>
                                </li>
                              );
                            })}
                          {historyEventBreakdown.transcripts.length === 0 ? <li className={styles.muted}>{t('history.noTranscript')}</li> : null}
                        </ol>
                      </div>
                      <div className={styles.recent}>
                        <div className={styles.listHeader}>
                          <h4 className={styles.subTitle}>{t('history.recentSuggestions')}</h4>
                          <span className={styles.meta}>{t('history.last5')}</span>
                        </div>
                        <ol className={styles.recentList}>
                          {historyEventBreakdown.suggestions
                            .slice(-5)
                            .reverse()
                            .map((event) => (
                              <li key={`suggestion-preview-${event.id}`}>
                                <span className={styles.categoryLabel}>
                                  {tAnswer.has(`category.${asText(event.payload.category)}`)
                                    ? tAnswer(`category.${asText(event.payload.category)}`)
                                    : tAnswer('category.other')}
                                </span>
                                <span className={styles.clamp}>{previewText(asText(event.payload.text, asText(event.payload.content, '—')))}</span>
                              </li>
                            ))}
                          {historyEventBreakdown.suggestions.length === 0 ? <li className={styles.muted}>{t('history.noSuggestions')}</li> : null}
                        </ol>
                      </div>
                    </div>

                    <div className={styles.report}>
                      <div className={styles.listHeader}>
                        <h4 className={styles.subTitle}>{t('report.title')}</h4>
                        <div className={styles.headerActions}>
                          {debug && historyReport ? (
                            <span className={styles.meta}>{historyReport.source === 'api' ? t('report.live') : t('report.legacy')}</span>
                          ) : null}
                          <button className="button buttonSmall" type="button" onClick={() => void copyReportSnapshot()} disabled={!historyReport}>
                            {historyReportCopied ? t('report.copied') : t('report.copy')}
                          </button>
                        </div>
                      </div>

                      {historyReportLoading ? <p className={styles.quietState}>{t('report.loading')}</p> : null}
                      {historyReportError ? <div className="error">{historyReportError}</div> : null}
                      {!historyReportLoading && !historyReport && !historyReportError ? <p className={styles.quietState}>{t('report.none')}</p> : null}

                      {historyReport ? (
                        <>
                          <dl className={styles.reportFigures}>
                            <div>
                              <dt>{t('report.overall')}</dt>
                              <dd className={styles.figure}>{historyReport.overallScore ?? '—'}</dd>
                            </div>
                            <div>
                              <dt>{t('report.signal')}</dt>
                              <dd className={styles.figureText}>{t(`signals.${historyReport.hiringSignal ?? 'unknown'}`)}</dd>
                            </div>
                          </dl>

                          {historyReport.summary ? <p className={styles.summaryText}>{historyReport.summary}</p> : null}

                          <ul className={styles.rubric}>
                            {RUBRIC_KEYS.map((key) => {
                              const item = historyReport.rubric[key];
                              return (
                                <li key={key} className={styles.rubricRow}>
                                  <div className={styles.rubricHead}>
                                    <span className={styles.rubricName}>{t(`rubric.${key}`)}</span>
                                    <span className={styles.rubricScore}>{item.score ?? '—'}/5</span>
                                  </div>
                                  <div className={styles.bar} aria-hidden="true">
                                    <span className={styles.barFill} style={{ transform: `scaleX(${asPercent(item.score, 5) / 100})` }} />
                                  </div>
                                  <p className={styles.rubricText}>
                                    <span className={styles.rubricLabel}>{t('report.evidence')}</span> {item.evidence || t('report.notCaptured')}
                                  </p>
                                  <p className={styles.rubricText}>
                                    <span className={styles.rubricLabel}>{t('report.recommendation')}</span> {item.recommendation || t('report.notCaptured')}
                                  </p>
                                </li>
                              );
                            })}
                          </ul>

                          <div className={styles.summaryColumns}>
                            <div>
                              <h5 className={styles.subTitle}>{t('report.strengths')}</h5>
                              <PointList items={historyReport.strengths} empty={t('report.noStrengths')} />
                            </div>
                            <div>
                              <h5 className={styles.subTitle}>{t('report.weaknesses')}</h5>
                              <PointList items={historyReport.weaknesses} empty={t('report.noWeaknesses')} />
                            </div>
                          </div>
                          <div>
                            <h5 className={styles.subTitle}>{t('report.nextSteps')}</h5>
                            <PointList items={historyReport.nextSteps} empty={t('report.noNextSteps')} />
                          </div>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </section>
            </div>

            <section className={styles.data} aria-label={t('data.label')}>
              <div className={styles.dataHeader}>
                <h3 className={styles.subTitle}>{t('data.title')}</h3>
                <p className={styles.meta}>{t('data.desc')}</p>
              </div>

              <div className={styles.dataRow}>
                <div className={styles.dataText}>
                  <h4 className={styles.dataName}>{t('data.exportTitle')}</h4>
                  <p className={styles.dataDesc}>{t('data.exportDesc')}</p>
                </div>
                <button className="button" type="button" onClick={() => void exportAllCopilotData()} disabled={exportingAllData || deleteAllPending}>
                  {exportingAllData ? t('data.exporting') : t('data.export')}
                </button>
              </div>

              <div className={styles.dataRow}>
                <div className={styles.dataText}>
                  <h4 className={styles.dataName}>{t('data.purgeTitle')}</h4>
                  <p className={styles.dataDesc}>{t.rich('data.purgeWarning', { strong: (chunks) => <strong>{chunks}</strong> })}</p>
                  <label className="label">
                    <span>{t.rich('data.purgeConfirm', { phrase: PURGE_PHRASE, code: (chunks) => <code>{chunks}</code> })}</span>
                    <input
                      className="input"
                      value={deleteAllConfirmation}
                      onChange={(e) => setDeleteAllConfirmation(e.target.value)}
                      placeholder={PURGE_PHRASE}
                      disabled={deleteAllPending || exportingAllData}
                    />
                  </label>
                </div>
                <button
                  className="button buttonDanger"
                  type="button"
                  onClick={() => void deleteAllCopilotData()}
                  disabled={isActive || deleteAllPending || exportingAllData || deleteAllConfirmation !== PURGE_PHRASE}
                >
                  {deleteAllPending ? t('data.purging') : t('data.purge')}
                </button>
              </div>

              {settingsError ? (
                <div className="error" role="status" aria-live="polite">
                  {settingsError}
                </div>
              ) : null}
              {settingsSuccess ? (
                <div className="success" role="status" aria-live="polite">
                  {settingsSuccess}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </section>

      {debug ? (
        <details className={styles.debug}>
          <summary className={styles.debugSummary}>{t.rich('diagnostics.summary', { strong: (chunks) => <strong>{chunks}</strong> })}</summary>
          {/* T4: Overlay controls with hotkey hints and performance instrumentation */}
          <section className={styles.debugBlock} aria-label={t('diagnostics.overlay')}>
            <div className={styles.listHeader}>
              <h3 className={styles.subTitle}>{t('diagnostics.overlay')}</h3>
              <span className={styles.meta}>{t('diagnostics.hotkeys')}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                className="button buttonSmall"
                type="button"
                onClick={() => {
                  const start = performance.now();
                  setOverlayVisible((prev) => {
                    const latencyMs = Math.round(performance.now() - start);
                    setInteractionLatency({ action: 'toggleOverlay', latencyMs });
                    sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, 'toggleOverlay', latencyMs);
                    updateSLOCompliance();

                    return !prev;
                  });
                }}
                aria-pressed={overlayVisible}
              >
                {overlayVisible ? t('diagnostics.hide') : t('diagnostics.show')}
              </button>
              <button
                className="button buttonSmall"
                type="button"
                onClick={() => {
                  const start = performance.now();
                  setOverlayMuted((prev) => {
                    const latencyMs = Math.round(performance.now() - start);
                    setInteractionLatency({ action: 'toggleMute', latencyMs });
                    sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, 'toggleMute', latencyMs);
                    updateSLOCompliance();

                    return !prev;
                  });
                }}
                aria-pressed={overlayMuted}
              >
                {overlayMuted ? t('diagnostics.unmute') : t('diagnostics.mute')}
              </button>
              <button
                className="button buttonSmall"
                type="button"
                onClick={() => {
                  const start = performance.now();
                  setOverlayTimerRunning((prev) => {
                    const latencyMs = Math.round(performance.now() - start);
                    setInteractionLatency({ action: 'toggleTimer', latencyMs });
                    sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, 'toggleTimer', latencyMs);
                    updateSLOCompliance();

                    return !prev;
                  });
                }}
                aria-pressed={overlayTimerRunning}
              >
                {overlayTimerRunning ? t('diagnostics.pauseTimer') : t('diagnostics.startTimer')}
              </button>
              <button
                className="button buttonSmall"
                type="button"
                onClick={() => {
                  const start = performance.now();
                  setOverlayTimerSeconds(0);
                  setOverlayTimerRunning(false);
                  const latencyMs = Math.round(performance.now() - start);
                  setInteractionLatency({ action: 'resetTimer', latencyMs });
                  sloClient.recordMetric(SLO_TYPE_OVERLAY_INTERACTION, 'resetTimer', latencyMs);
                  updateSLOCompliance();
                }}
                disabled={overlayTimerSeconds === 0}
              >
                {t('diagnostics.resetTimer')}
              </button>
              <span className="badge tnum">
                {Math.floor(overlayTimerSeconds / 60)
                  .toString()
                  .padStart(2, '0')}
                :{(overlayTimerSeconds % 60).toString().padStart(2, '0')}
              </span>
              {overlayMuted && <span className="badge badgeAlert">{t('diagnostics.muted')}</span>}
            </div>
            {/* Performance metrics display for SLO verification */}
            {interactionLatency.latencyMs !== null && (
              <p className={styles.meta}>
                {t.rich('diagnostics.lastInteraction', {
                  action: interactionLatency.action,
                  ms: interactionLatency.latencyMs,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}{' '}
                {interactionLatency.latencyMs <= 100
                  ? t('diagnostics.withinSlo', { target: '<100ms' })
                  : t('diagnostics.exceedsSlo', { target: '<100ms' })}
              </p>
            )}
          </section>

          {/* PRD T4: Real-time SLO compliance status display */}
          <section className={styles.debugBlock} aria-label={t('diagnostics.sloLabel')}>
            <div className={styles.listHeader}>
              <h3 className={styles.subTitle}>{t('diagnostics.slo')}</h3>
              <span className={styles.meta}>{t('diagnostics.realtime')}</span>
            </div>
            <div className={styles.debugGrid}>
              {sloCompliance.map((compliance) => {
                const isOverlay = compliance.type === 'overlay_interaction';
                const targetLabel = isOverlay ? t('diagnostics.overlayInteraction') : t('diagnostics.transcriptToSuggestion');
                const targetSlo = isOverlay ? '<100ms' : '<3s';

                return (
                  <div key={compliance.type} className={styles.debugItem}>
                    <div className={styles.listHeader}>
                      <span className={styles.rubricName}>{targetLabel}</span>
                      <span className="badge">
                        {getStatusEmoji(compliance.currentStatus)}{' '}
                        {t.has(`diagnostics.status.${compliance.currentStatus}`) ? t(`diagnostics.status.${compliance.currentStatus}`) : compliance.currentStatus}
                      </span>
                    </div>
                    {compliance.totalSamples > 0 ? (
                      <>
                        <span className={styles.meta}>
                          p50 <strong>{formatLatency(compliance.p50)}</strong> · p95 <strong>{formatLatency(compliance.p95)}</strong>
                        </span>
                        <div className={styles.bar} aria-hidden="true">
                          <span
                            className={styles.barFill}
                            style={{ transform: `scaleX(${Math.min(1, compliance.withinTarget / compliance.totalSamples)})` }}
                          />
                        </div>
                        <span className={styles.meta}>
                          {t('diagnostics.withinCount', { within: compliance.withinTarget, total: compliance.totalSamples, target: targetSlo })}
                        </span>
                      </>
                    ) : (
                      <p className={styles.meta}>{t('diagnostics.noSamples')}</p>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Recent metrics mini-display */}
            {recentSloMetrics.length > 0 && (
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                <span className={styles.meta}>{t('diagnostics.recent')}</span>
                {recentSloMetrics
                  .slice(-5)
                  .reverse()
                  .map((metric, idx) => (
                    <span
                      key={`${metric.timestamp}-${idx}`}
                      className={`badge ${metric.status === 'critical' ? 'badgeAlert' : ''}`}
                      title={`${metric.action}: ${format.number(metric.latencyMs, { style: 'unit', unit: 'millisecond' })}`}
                    >
                      {formatLatency(metric.latencyMs)}
                    </span>
                  ))}
              </div>
            )}
          </section>
        </details>
      ) : null}

      {isActive ? (
        <div className={styles.mobileBar} role="group" aria-label={t('controlsLabel')}>
          <button
            className={`button ${styles.barIcon}`}
            type="button"
            onClick={toggleListening}
            disabled={audio.status === 'starting'}
            aria-label={listenLabel}
            title={listenLabel}
            data-live={audio.status === 'live' ? '' : undefined}
          >
            <MicIcon size={18} />
          </button>
          {!singleMic ? (
            <button
              className={`button ${styles.barIcon}`}
              type="button"
              onClick={() => void solveScreen()}
              disabled={audio.status !== 'live'}
              aria-label={tAnswer('solveScreen')}
              title={tAnswer('solveScreen')}
            >
              <ScreenIcon size={18} />
            </button>
          ) : null}
          <button className={`button buttonPrimary ${styles.barPrimary}`} type="button" onClick={answerNow}>
            {tAnswer('answerNow')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
