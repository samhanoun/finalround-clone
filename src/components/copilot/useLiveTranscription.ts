'use client';

import { useEffect, useRef, useState } from 'react';
import { LiveTranscriber, type LiveSttStatus, type SpeakerRole } from '@/lib/stt/deepgramLive';
import { sttStreamUrl, type SttErrorCode } from '@/lib/stt/relayProtocol';
import type { SpeakerResolver } from '@/lib/stt/speakers';
import { UtteranceAssembler, type Utterance } from '@/lib/stt/utterances';
import type { AudioCapture } from './useAudioCapture';

export type LiveCaptions = Record<SpeakerRole, string>;

const NO_CAPTIONS: LiveCaptions = { candidate: '', interviewer: '' };

/**
 * Streams the live capture to Deepgram while the session is active and audio
 * is live. Committed utterances go to `onUtterance`; captions show what each
 * speaker is saying right now. With `speakers` (phone / in-person mode) one
 * microphone carries both people and the resolver tells them apart.
 */
export function useLiveTranscription({
  sessionId,
  capture,
  onUtterance,
  speakers = null,
}: {
  sessionId: string | null;
  capture: Pick<AudioCapture, 'status' | 'subscribeFrames' | 'subscribeLevels'>;
  onUtterance: (utterance: Utterance) => void;
  speakers?: SpeakerResolver | null;
}) {
  const [status, setStatus] = useState<LiveSttStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<SttErrorCode | null>(null);
  const [captions, setCaptions] = useState<LiveCaptions>(NO_CAPTIONS);
  const onUtteranceRef = useRef(onUtterance);

  useEffect(() => {
    onUtteranceRef.current = onUtterance;
  }, [onUtterance]);

  const { status: captureStatus, subscribeFrames, subscribeLevels } = capture;
  const enabled = captureStatus === 'live' && !!sessionId;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    // Silence isn't sent (client voice detection), which cuts transcription cost.
    const transcriber = new LiveTranscriber({
      getUrl: () => sttStreamUrl(sessionId, window.location),
      gateSilence: true,
      speakers: speakers ?? undefined,
    });
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
    transcriber.onStatus((next, message, code) => {
      const cleared = next === 'live' || next === 'closed';
      setStatus(next);
      setError(cleared ? null : message);
      setErrorCode(cleared ? null : code);
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
  }, [enabled, sessionId, subscribeFrames, subscribeLevels, speakers]);

  return { status: enabled ? status : 'idle', error, errorCode, captions } as const;
}

export type LiveTranscription = ReturnType<typeof useLiveTranscription>;
