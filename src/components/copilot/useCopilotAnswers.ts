'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AnswerController,
  IDLE_ANSWER,
  type AnswerRequest,
  type AnswerResult,
  type AnswerState,
} from '@/lib/copilot/answerController';
import type { TranscriptLine } from '@/lib/copilot/answerPrompt';
import {
  QUESTION_CATEGORIES,
  QuestionGate,
  categorizeQuestion,
  type ClassifierResult,
  type GatedQuestion,
  type QuestionCategory,
} from '@/lib/copilot/questionGate';
import { latencyEventPayload, type TurnTiming } from '@/lib/copilot/latency';
import { readAnswerStream } from '@/lib/copilot/sse';
import type { Utterance } from '@/lib/stt/utterances';

const ANSWER_ERRORS: Record<string, string> = {
  answers_unavailable: 'Answers are not set up on the server (no API key for the answer model).',
  question_blocked: 'That question looked like an attempt to steer the assistant, so it was not answered.',
  quota_exceeded: 'You have used all your copilot minutes for now.',
  quota_unavailable: 'Your plan could not be checked (SUPABASE_SERVICE_ROLE_KEY missing?).',
  session_expired: 'This copilot session expired. Start a new one.',
  session_not_active: 'This copilot session has ended.',
  rate_limited: 'Too many answers in a short time. Try again in a moment.',
  image_too_large: 'The screen capture was too large to send.',
  invalid_image: 'The screen capture could not be read.',
};

/** What a Solve screen request shows as its question. */
export const SCREEN_QUESTION_TEXT = 'What’s on the shared screen';

/** Lines of conversation sent with each question. */
const RECENT_LINES = 12;

async function streamAnswer(
  sessionId: string,
  question: AnswerRequest,
  recentTranscript: TranscriptLine[],
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<AnswerResult> {
  // Solve screen sends the frame; spoken and typed questions send the text.
  const res = question.screen
    ? await fetch(`/api/copilot/sessions/${sessionId}/screen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: question.screen.jpegBase64, recentTranscript }),
        signal,
      })
    : await fetch(`/api/copilot/sessions/${sessionId}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: question.text,
          category: question.category,
          trigger: question.trigger,
          recentTranscript,
        }),
        signal,
      });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    const code = json.error ?? `http_${res.status}`;
    throw new Error(ANSWER_ERRORS[code] ?? `Could not get an answer (${code}).`);
  }
  const done = await readAnswerStream(res.body, onText);
  return { model: done.model, ttftMs: done.ttftMs ?? null };
}

/** The classifier is optional: any failure means "no opinion", and the gate's fallback decides. */
async function classifyLine(sessionId: string, text: string, signal: AbortSignal): Promise<ClassifierResult | null> {
  try {
    const res = await fetch(`/api/copilot/sessions/${sessionId}/gate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { answer?: unknown; category?: unknown };
    if (typeof json.answer !== 'boolean') return null;
    const category = QUESTION_CATEGORIES.includes(json.category as QuestionCategory)
      ? (json.category as QuestionCategory)
      : 'other';
    return { answer: json.answer, category };
  } catch {
    return null;
  }
}

/** The latest answer state, readable with useSyncExternalStore. */
/** Most recent question timings first-in-first-out, for the latency drawer. */
const MAX_TURNS = 50;

function createTurnStore() {
  let turns: TurnTiming[] = [];
  const listeners = new Set<() => void>();
  return {
    getTurns: () => turns,
    add(turn: TurnTiming) {
      turns = [...turns, turn].slice(-MAX_TURNS);
      listeners.forEach((listener) => listener());
    },
    clear() {
      turns = [];
      listeners.forEach((listener) => listener());
    },
    subscribeTurns(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Fire-and-forget; keepalive lets it finish even if the page is closing. */
function sendLatency(sessionId: string, turn: TurnTiming) {
  void fetch(`/api/copilot/sessions/${sessionId}/latency`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turns: [latencyEventPayload(turn)] }),
    keepalive: true,
  }).catch(() => undefined);
}

function createAnswerStore() {
  let state: AnswerState = IDLE_ANSWER;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    set(next: AnswerState) {
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Lines already inside the question text don't need to be sent twice. */
function contextFor(question: GatedQuestion, recent: TranscriptLine[]): TranscriptLine[] {
  return recent.filter((line) => !(line.speaker === 'interviewer' && question.text.includes(line.text)));
}

/**
 * Decides which interviewer lines get an answer (question gate), streams the
 * answer, and makes sure only the latest question's answer lands.
 *
 * Answer state changes many times a second while text streams, so it lives
 * in a small store (`subscribe` / `getState`) that only the answer card reads,
 * instead of React state that would re-render the whole page.
 */
export function useCopilotAnswers({ sessionId }: { sessionId: string | null }) {
  const gateRef = useRef<QuestionGate | null>(null);
  const controllerRef = useRef<AnswerController | null>(null);
  const recentRef = useRef<TranscriptLine[]>([]);
  const [store] = useState(createAnswerStore);
  const [turnStore] = useState(createTurnStore);

  const remember = useCallback((line: TranscriptLine) => {
    recentRef.current = [...recentRef.current, line].slice(-RECENT_LINES);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    recentRef.current = [];

    const controller = new AnswerController((question, signal, onText) =>
      streamAnswer(sessionId, question, contextFor(question, recentRef.current), signal, onText),
    );
    const gate = new QuestionGate({
      onQuestion: (question) => void controller.request(question),
      classify: (text, signal) => classifyLine(sessionId, text, signal),
    });
    const unsubscribe = controller.subscribe((state) => store.set(state));
    turnStore.clear();
    const unsubscribeTurns = controller.onTurn((turn) => {
      turnStore.add(turn);
      sendLatency(sessionId, turn);
    });
    controllerRef.current = controller;
    gateRef.current = gate;

    return () => {
      unsubscribe();
      unsubscribeTurns();
      gate.reset();
      controller.reset();
      if (gateRef.current === gate) gateRef.current = null;
      if (controllerRef.current === controller) controllerRef.current = null;
      store.set(IDLE_ANSWER);
    };
  }, [sessionId, store, turnStore]);

  /** Every committed speech utterance, both speakers. */
  const observe = useCallback(
    (utterance: Utterance) => {
      void gateRef.current?.observe(utterance);
      remember({ speaker: utterance.role, text: utterance.text });
    },
    [remember],
  );

  /** Answer now. Returns false when there is no interviewer line to answer yet. */
  const answerNow = useCallback((liveInterviewerText?: string) => {
    return gateRef.current?.answerNow(liveInterviewerText) != null;
  }, []);

  /** A line typed in the composer: interviewer lines are always answered. */
  const addTypedLine = useCallback(
    (speaker: TranscriptLine['speaker'], text: string) => {
      const controller = controllerRef.current;
      if (speaker === 'interviewer' && controller) {
        void controller.request({
          text,
          category: categorizeQuestion(text),
          trigger: 'manual',
          via: 'manual',
          score: 1,
          decidedAt: Date.now(),
        });
      }
      remember({ speaker, text });
    },
    [remember],
  );

  /** Solve screen: answer from a frame of the shared screen. Replaces any answer in flight. */
  const answerScreen = useCallback((frame: { jpegBase64: string }) => {
    const controller = controllerRef.current;
    if (!controller) return false;
    void controller.request({
      text: SCREEN_QUESTION_TEXT,
      category: 'coding',
      trigger: 'manual',
      via: 'screen',
      score: 1,
      decidedAt: Date.now(),
      screen: frame,
    });
    return true;
  }, []);

  const stop = useCallback(() => controllerRef.current?.cancel(), []);

  return useMemo(
    () => ({
      observe,
      answerNow,
      answerScreen,
      addTypedLine,
      stop,
      subscribe: store.subscribe,
      getState: store.getState,
      subscribeTurns: turnStore.subscribeTurns,
      getTurns: turnStore.getTurns,
    }),
    [observe, answerNow, answerScreen, addTypedLine, stop, store, turnStore],
  );
}

export type CopilotAnswers = ReturnType<typeof useCopilotAnswers>;
