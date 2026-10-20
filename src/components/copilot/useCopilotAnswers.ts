'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnswerController, type AnswerState } from '@/lib/copilot/answerController';
import {
  QUESTION_CATEGORIES,
  QuestionGate,
  type ClassifierResult,
  type GatedQuestion,
  type QuestionCategory,
} from '@/lib/copilot/questionGate';
import type { Utterance } from '@/lib/stt/utterances';

/** The suggestion event the answer route saves (same shape as other copilot events). */
export type AnswerEvent = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const ANSWER_ERRORS: Record<string, string> = {
  answers_unavailable: 'Answers are not set up on the server (OPENAI_API_KEY is missing).',
  question_blocked: 'That question looked like an attempt to steer the assistant, so it was not answered.',
  session_expired: 'This copilot session expired. Start a new one.',
  session_not_active: 'This copilot session has ended.',
  rate_limited: 'Too many answers in a short time. Try again in a moment.',
};

const IDLE: AnswerState = { status: 'idle', question: null, error: null, superseded: 0 };

async function postAnswer(sessionId: string, question: GatedQuestion, signal: AbortSignal): Promise<AnswerEvent> {
  const res = await fetch(`/api/copilot/sessions/${sessionId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: question.text, category: question.category, trigger: question.trigger }),
    signal,
  });
  const json = (await res.json().catch(() => ({}))) as { suggestion?: AnswerEvent; error?: string };
  if (!res.ok || !json.suggestion) {
    const code = json.error ?? `http_${res.status}`;
    throw new Error(ANSWER_ERRORS[code] ?? `Could not get an answer (${code}).`);
  }
  return json.suggestion;
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

/**
 * Decides which interviewer lines get an answer (question gate), asks for it,
 * and makes sure only the latest question's answer lands.
 */
export function useCopilotAnswers({
  sessionId,
  onAnswer,
}: {
  sessionId: string | null;
  onAnswer: (event: AnswerEvent) => void;
}) {
  const [state, setState] = useState<AnswerState>(IDLE);
  const gateRef = useRef<QuestionGate | null>(null);
  const controllerRef = useRef<AnswerController | null>(null);
  const onAnswerRef = useRef(onAnswer);

  useEffect(() => {
    onAnswerRef.current = onAnswer;
  }, [onAnswer]);

  useEffect(() => {
    if (!sessionId) return;

    const controller = new AnswerController(async (question, signal) => {
      const event = await postAnswer(sessionId, question, signal);
      if (!signal.aborted) onAnswerRef.current(event);
    });
    const gate = new QuestionGate({
      onQuestion: (question) => void controller.request(question),
      classify: (text, signal) => classifyLine(sessionId, text, signal),
    });
    const unsubscribe = controller.subscribe(setState);
    controllerRef.current = controller;
    gateRef.current = gate;

    return () => {
      unsubscribe();
      gate.reset();
      controller.reset();
      if (gateRef.current === gate) gateRef.current = null;
      if (controllerRef.current === controller) controllerRef.current = null;
      setState(IDLE);
    };
  }, [sessionId]);

  const observe = useCallback((utterance: Utterance) => {
    void gateRef.current?.observe(utterance);
  }, []);

  /** Returns false when there is no interviewer line to answer yet. */
  const answerNow = useCallback((liveInterviewerText?: string) => {
    return gateRef.current?.answerNow(liveInterviewerText) != null;
  }, []);

  const stop = useCallback(() => controllerRef.current?.cancel(), []);

  return { state: sessionId ? state : IDLE, observe, answerNow, stop } as const;
}

export type CopilotAnswers = ReturnType<typeof useCopilotAnswers>;
