'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { micChannel } from '@/lib/audio/capture';
import { SpeakerResolver } from '@/lib/stt/speakers';
import { parseVoiceprint, voiceprint, type Voiceprint } from '@/lib/stt/voiceprint';
import type { AudioCapture } from './useAudioCapture';

const STORAGE_KEY = 'copilot.voiceSample.v1';
export const SAMPLE_SECONDS = 8;
/** Less speech than this in the sample isn't enough to recognise the voice. */
const MIN_SAMPLE_SPEECH_SECONDS = 2.5;

export type VoiceSampleState = 'none' | 'recording' | 'ready';

function loadSaved(): Voiceprint | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseVoiceprint(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function save(print: Voiceprint | null) {
  try {
    if (print) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(print));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private windows can refuse storage; the sample still works for this page.
  }
}

/**
 * Phone / in-person mode: a few seconds of the candidate reading aloud, so
 * their voice can be told from the interviewer's on the one microphone. Only
 * the voice's numbers (src/lib/stt/voiceprint.ts) are kept, in this browser;
 * never the recording. Owns the SpeakerResolver the transcriber uses.
 */
export function useVoiceSample(capture: Pick<AudioCapture, 'status' | 'subscribeFrames'>) {
  const [resolver] = useState(() => new SpeakerResolver());
  const [print, setPrint] = useState<Voiceprint | null>(null);
  const [recording, setRecording] = useState(false);
  /** 0–1 in tenths, so the page re-renders a few times a second at most. */
  const [progress, setProgress] = useState(0);
  const [tooQuiet, setTooQuiet] = useState(false);
  const stopRecording = useRef<(() => void) | null>(null);

  useEffect(() => {
    const saved = loadSaved();
    resolver.setSample(saved);
    // Storage is only readable after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrint(saved);
  }, [resolver]);

  const cancel = useCallback(() => {
    stopRecording.current?.();
    stopRecording.current = null;
    resolver.cancelCalibration();
    setRecording(false);
    setProgress(0);
  }, [resolver]);

  const { status, subscribeFrames } = capture;
  const record = useCallback(() => {
    if (status !== 'live' || stopRecording.current) return;
    const speakers = resolver;
    const chunks: Int16Array[] = [];
    let samples = 0;
    let sampleRate = 16000;
    speakers.startCalibration(Date.now());
    setTooQuiet(false);
    setProgress(0);
    setRecording(true);

    const unsubscribe = subscribeFrames((frame) => {
      const mono = micChannel(frame.pcm);
      chunks.push(mono);
      samples += mono.length;
      sampleRate = frame.sampleRate;
      const done = samples / (SAMPLE_SECONDS * sampleRate);
      setProgress(Math.min(1, Math.floor(done * 10) / 10));
      if (done < 1) return;

      unsubscribe();
      stopRecording.current = null;
      const audio = new Int16Array(samples);
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.length;
      }
      const sample = voiceprint(audio, sampleRate);
      if (!sample || sample.seconds < MIN_SAMPLE_SPEECH_SECONDS) {
        speakers.cancelCalibration();
        setTooQuiet(true);
      } else {
        speakers.finishCalibration(Date.now(), sample);
        save(sample);
        setPrint(sample);
      }
      setRecording(false);
    });
    stopRecording.current = unsubscribe;
  }, [status, subscribeFrames, resolver]);

  // Listening stopped mid-sample: nothing more will arrive.
  useEffect(() => {
    if (status !== 'live' && stopRecording.current) cancel();
  }, [status, cancel]);

  useEffect(() => () => stopRecording.current?.(), []);

  const forget = useCallback(() => {
    save(null);
    resolver.setSample(null);
    setPrint(null);
  }, [resolver]);

  const state: VoiceSampleState = recording ? 'recording' : print ? 'ready' : 'none';
  return useMemo(
    () => ({ state, progress, tooQuiet, record, cancel, forget, resolver }),
    [state, progress, tooQuiet, record, cancel, forget, resolver],
  );
}

export type VoiceSample = ReturnType<typeof useVoiceSample>;
