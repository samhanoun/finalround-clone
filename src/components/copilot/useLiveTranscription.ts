'use client';

import { useEffect, useRef, useState } from 'react';
import {
  LiveTranscriber,
  SttTokenError,
  type LiveSttStatus,
  type SpeakerRole,
  type SttToken,
} from '@/lib/stt/deepgramLive';
import { UtteranceAssembler, type Utterance } from '@/lib/stt/utterances';
import type { AudioCapture } from './useAudioCapture';

export type LiveCaptions = Record<SpeakerRole, string>;

const NO_CAPTIONS: LiveCaptions = { candidate: '', interviewer: '' };

const TOKEN_ERRORS: Record<string, string> = {
  unauthorized: 'You were signed out. Sign in again to keep transcribing.',
  session_not_found: 'This copilot session no longer exists.',
  session_not_active: 'This copilot session has ended.',
  session_expired: 'This copilot session expired. Start a new one.',
  quota_exceeded: 'You have used all your copilot minutes for now.',
  stt_not_configured: 'Live transcription is not set up on the server (DEEPGRAM_API_KEY is missing).',
};

export async function fetchSttToken(sessionId: string): Promise<SttToken> {
  let res: Response;
  try {
    res = await fetch('/api/stt/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      cache: 'no-store',
    });
  } catch {
    throw new SttTokenError('Could not reach the server. Retrying…', true);
  }

  const json = (await res.json().catch(() => ({}))) as Partial<SttToken> & { error?: string };
  if (!res.ok || !json.token || !json.listenUrl) {
    const retryable = res.ok || res.status === 429 || (res.status >= 500 && res.status !== 503);
    const code = json.error ?? `http_${res.status}`;
    throw new SttTokenError(TOKEN_ERRORS[code] ?? `Live transcription is unavailable (${code}).`, retryable);
  }
  return { token: json.token, listenUrl: json.listenUrl, expiresIn: json.expiresIn };
}

/**
 * Streams the live capture to Deepgram while the session is active and audio
 * is live. Committed utterances go to `onUtterance`; captions show what each
 * speaker is saying right now.
 */
export function useLiveTranscription({
  sessionId,
  capture,
  onUtterance,
}: {
  sessionId: string | null;
  capture: Pick<AudioCapture, 'status' | 'subscribeFrames' | 'subscribeLevels'>;
  onUtterance: (utterance: Utterance) => void;
}) {
  const [status, setStatus] = useState<LiveSttStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<LiveCaptions>(NO_CAPTIONS);
  const onUtteranceRef = useRef(onUtterance);

  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);

  const { status: captureStatus, subscribeFrames, subscribeLevels } = capture;
  const enabled = captureStatus === 'live' && !!sessionId;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const transcriber = new LiveTranscriber({ getToken: () => fetchSttToken(sessionId) });
    const assembler = new UtteranceAssembler((utterance) => onUtteranceRef.current(utterance));
    const refreshCaptions = () =>
      setCaptions({ candidate: assembler.liveText('candidate'), interviewer: assembler.liveText('interviewer') });

    transcriber.onResult((result) => {
      assembler.push(result);
      refreshCaptions();
    });
    transcriber.onUtteranceEnd((event) => {
      assembler.endOfUtterance(event.role, event.receivedAt);
      refreshCaptions();
    });
    transcriber.onStatus((next, message) => {
      setStatus(next);
      setError(next === 'live' || next === 'closed' ? null : message);
    });

    const unsubscribeFrames = subscribeFrames((frame) => transcriber.sendFrame(frame));
    const unsubscribeLevels = subscribeLevels((levels) => transcriber.noteLevels(levels));
    // start() reports 'connecting' synchronously, which also clears the last error.
    transcriber.start();

    return () => {
      unsubscribeFrames();
      unsubscribeLevels();
      // Deepgram sends its last finals before closing; commit them, then clear.
      void transcriber.stop().then(() => {
        assembler.flush(Date.now());
        setCaptions(NO_CAPTIONS);
      });
    };
  }, [enabled, sessionId, subscribeFrames, subscribeLevels]);

  return { status: enabled ? status : 'idle', error, captions } as const;
}

export type LiveTranscription = ReturnType<typeof useLiveTranscription>;
