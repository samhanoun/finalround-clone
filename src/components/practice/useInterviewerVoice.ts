'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

const MUTED_KEY = 'practice.interviewerMuted';

const noSubscription = () => () => undefined;

function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

/** A voice for the page's language: same locale first, then same language, preferring ones the device has offline. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const wanted = lang.toLowerCase();
  const base = wanted.split('-')[0];
  const score = (voice: SpeechSynthesisVoice) => {
    const voiceLang = voice.lang.toLowerCase().replace('_', '-');
    const match = voiceLang === wanted ? 2 : voiceLang.split('-')[0] === base ? 1 : 0;
    return match * 10 + (voice.localService ? 1 : 0);
  };
  const best = [...voices].sort((a, b) => score(b) - score(a))[0];
  return best && score(best) >= 10 ? best : null;
}

/**
 * The practice interviewer reads questions aloud with the browser's own
 * speech synthesis (nothing is sent anywhere). Muting is remembered in this
 * browser.
 */
export function useInterviewerVoice(lang: string) {
  const supported = useSyncExternalStore(noSubscription, canSpeak, () => false);
  const [muted, setMutedState] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    try {
      // Storage is only readable after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMutedState(window.localStorage.getItem(MUTED_KEY) === '1');
    } catch {
      // Storage blocked: start unmuted.
    }
  }, []);

  const stop = useCallback(() => {
    if (canSpeak()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!supported || muted || !text.trim()) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      const voice = pickVoice(synth.getVoices(), lang);
      if (voice) utterance.voice = voice;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      synth.speak(utterance);
    },
    [supported, muted, lang],
  );

  const setMuted = useCallback(
    (next: boolean) => {
      setMutedState(next);
      if (next) stop();
      try {
        window.localStorage.setItem(MUTED_KEY, next ? '1' : '0');
      } catch {
        // Not remembered, but still applies to this page.
      }
    },
    [stop],
  );

  // Leaving the page stops the interviewer mid-sentence.
  useEffect(() => () => stop(), [stop]);

  return { supported, speaking, muted, setMuted, speak, stop };
}

export type InterviewerVoice = ReturnType<typeof useInterviewerVoice>;
