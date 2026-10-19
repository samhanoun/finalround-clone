'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DualAudioCapture, type CaptureFrame, type CaptureLevels } from '@/lib/audio/capture';

export type AudioCaptureStatus = 'idle' | 'starting' | 'live' | 'error';

export type AudioCapture = ReturnType<typeof useAudioCapture>;

/**
 * Owns one DualAudioCapture at a time. Frames and levels are delivered through
 * subscriptions rather than React state so 20 updates a second don't re-render
 * the whole copilot page.
 */
export function useAudioCapture() {
  const captureRef = useRef<DualAudioCapture | null>(null);
  const frameListeners = useRef(new Set<(frame: CaptureFrame) => void>());
  const levelListeners = useRef(new Set<(levels: CaptureLevels) => void>());
  const [status, setStatus] = useState<AudioCaptureStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setStatus('idle');
  }, []);

  // Call from a click/keydown handler: the screen-share prompt needs the user gesture.
  const start = useCallback(async () => {
    if (captureRef.current) return;
    const capture = new DualAudioCapture();
    captureRef.current = capture;
    setError(null);
    setStatus('starting');

    capture.onFrame((frame) => frameListeners.current.forEach((listener) => listener(frame)));
    capture.onLevels((levels) => levelListeners.current.forEach((listener) => listener(levels)));
    capture.onEnded((source) => {
      if (captureRef.current !== capture) return;
      capture.stop();
      captureRef.current = null;
      setStatus('idle');
      setError(
        source === 'interviewer'
          ? 'Meeting audio sharing stopped. Start listening again to keep transcribing.'
          : 'Your microphone was disconnected. Start listening again.',
      );
    });

    try {
      await capture.start();
      if (captureRef.current === capture) setStatus('live');
    } catch (e) {
      capture.stop();
      if (captureRef.current === capture) captureRef.current = null;
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Could not start audio capture.');
    }
  }, []);

  useEffect(
    () => () => {
      captureRef.current?.stop();
      captureRef.current = null;
    },
    [],
  );

  const subscribeFrames = useCallback((listener: (frame: CaptureFrame) => void) => {
    frameListeners.current.add(listener);
    return () => {
      frameListeners.current.delete(listener);
    };
  }, []);

  const subscribeLevels = useCallback((listener: (levels: CaptureLevels) => void) => {
    levelListeners.current.add(listener);
    return () => {
      levelListeners.current.delete(listener);
    };
  }, []);

  const getDisplayVideoTrack = useCallback(() => captureRef.current?.getDisplayVideoTrack() ?? null, []);

  return useMemo(
    () => ({ status, error, start, stop, subscribeFrames, subscribeLevels, getDisplayVideoTrack }),
    [status, error, start, stop, subscribeFrames, subscribeLevels, getDisplayVideoTrack],
  );
}
