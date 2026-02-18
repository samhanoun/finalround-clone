/**
 * Video Conferencing Client Hooks
 * 
 * Browser-side hooks for screen share detection and audio capture
 * that integrate with the video conferencing service.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { VideoPlatform, VideoSession } from '@/lib/videoConferencingTypes';

/**
 * Hook for detecting screen share events in the browser
 */
export function useScreenShareDetection(
  sessionId: string | null,
  platform: VideoPlatform,
  enabled: boolean = true
) {
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareSource, setScreenShareSource] = useState<{
    id: string;
    name: string;
    width: number;
    height: number;
  } | null>(null);
  const eventListeners = useRef<Set<() => void>>(new Set());

  // Listen for screen share events from the API
  useEffect(() => {
    if (!sessionId || !enabled) return;

    const handleScreenShareStart = async (source: {
      id: string;
      name: string;
      width: number;
      height: number;
    }) => {
      setIsScreenSharing(true);
      setScreenShareSource(source);
      
      // Notify backend
      try {
        await fetch(`/api/video-sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'screen_share_start',
            ...source,
          }),
        });
      } catch (error) {
        console.error('Failed to report screen share start:', error);
      }
      
      // Notify listeners
      eventListeners.current.forEach(listener => listener());
    };

    const handleScreenShareStop = async () => {
      setIsScreenSharing(false);
      
      // Notify backend
      try {
        await fetch(`/api/video-sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'screen_share_stop',
          }),
        });
      } catch (error) {
        console.error('Failed to report screen share stop:', error);
      }
      
      setScreenShareSource(null);
    };

    // Check for screen share using the Screen Share API
    const checkScreenShare = async () => {
      try {
        // @ts-expect-error - displayMedia is not in TypeScript's standard lib
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
          // Listen for screen share start via the API
          navigator.mediaDevices.ondevicechange = async (event: Event) => {
            // @ts-expect-error - event tracking for screen share
            const streams = event.streams;
          };
        }
      } catch (error) {
        console.error('Error checking screen share:', error);
      }
    };

    // Poll for screen share state changes
    const interval = setInterval(checkScreenShare, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [sessionId, enabled]);

  const startScreenShare = useCallback(async () => {
    try {
      // Use the Screen Share API
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        } as MediaTrackConstraints,
        audio: false,
      });

      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      
      const source = {
        id: settings.deviceId || 'unknown',
        name: videoTrack.label || 'Screen',
        width: settings.width || 0,
        height: settings.height || 0,
      };

      // Listen for when user stops sharing via browser UI
      videoTrack.onended = () => {
        setIsScreenSharing(false);
        setScreenShareSource(null);
      };

      setIsScreenSharing(true);
      setScreenShareSource(source);

      return stream;
    } catch (error) {
      console.error('Failed to start screen share:', error);
      throw error;
    }
  }, []);

  const stopScreenShare = useCallback(async (stream: MediaStream) => {
    stream.getTracks().forEach(track => track.stop());
    setIsScreenSharing(false);
    setScreenShareSource(null);
  }, []);

  return {
    isScreenSharing,
    screenShareSource,
    startScreenShare,
    stopScreenShare,
  };
}

/**
 * Hook for audio capture during video conferences
 */
export function useAudioCapture(
  sessionId: string | null,
  enabled: boolean = true,
  options?: {
    deviceId?: string;
    sampleRate?: number;
    channels?: number;
  }
) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);

  // Get available audio input devices
  useEffect(() => {
    async function getDevices() {
      try {
        // Request permission first
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
      } catch (error) {
        console.error('Failed to get audio devices:', error);
      }
    }
    
    getDevices();
  }, []);

  const startCapture = useCallback(async () => {
    if (isCapturing) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: options?.deviceId ? { exact: options.deviceId } : undefined,
          sampleRate: options?.sampleRate || 16000,
          channelCount: options?.channels || 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Set up audio analysis
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      
      streamRef.current = stream;
      analyserRef.current = analyser;
      
      // Update audio level periodically
      const updateLevel = () => {
        if (!analyserRef.current) return;
        
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(rms / 128, 1);
        
        setAudioLevel(level);
        animationRef.current = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
      setIsCapturing(true);
      
      // Notify backend
      if (sessionId) {
        try {
          await fetch(`/api/video-sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'audio_capture_start',
              deviceId: options?.deviceId,
              sampleRate: options?.sampleRate || 16000,
              channels: options?.channels || 1,
            }),
          });
        } catch (error) {
          console.error('Failed to report audio capture start:', error);
        }
      }
      
      return stream;
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      throw error;
    }
  }, [isCapturing, options, sessionId]);

  const stopCapture = useCallback(async () => {
    if (!isCapturing || !streamRef.current) return;
    
    // Stop audio analysis
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    // Stop all tracks
    streamRef.current.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    
    setIsCapturing(false);
    setAudioLevel(0);
    
    // Notify backend
    if (sessionId) {
      try {
        await fetch(`/api/video-sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'audio_capture_stop',
          }),
        });
      } catch (error) {
        console.error('Failed to report audio capture stop:', error);
      }
    }
  }, [isCapturing, sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    isCapturing,
    audioLevel,
    audioDevices,
    startCapture,
    stopCapture,
  };
}

/**
 * Hook for platform auto-detection
 */
export function usePlatformDetection() {
  const [currentPlatform, setCurrentPlatform] = useState<{
    platform: VideoPlatform | 'unknown';
    confidence: number;
    isActive: boolean;
  }>({
    platform: 'unknown',
    confidence: 0,
    isActive: false,
  });
  const [isDetecting, setIsDetecting] = useState(false);

  const detectPlatform = useCallback(async () => {
    setIsDetecting(true);
    
    try {
      const url = window.location.href;
      const title = document.title;
      
      const res = await fetch('/api/video-sessions/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setCurrentPlatform({
          platform: data.platform,
          confidence: data.confidence,
          isActive: data.isMeetingActive,
        });
      }
    } catch (error) {
      console.error('Failed to detect platform:', error);
    } finally {
      setIsDetecting(false);
    }
  }, []);

  // Detect on mount and URL changes
  useEffect(() => {
    detectPlatform();
    
    // Listen for URL changes (for SPAs)
    const observer = new MutationObserver(() => {
      detectPlatform();
    });
    
    observer.observe(document.body, { 
      childList: true, 
      subtree: true 
    });
    
    // Also check on popstate (back/forward navigation)
    window.addEventListener('popstate', detectPlatform);
    
    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', detectPlatform);
    };
  }, [detectPlatform]);

  return {
    ...currentPlatform,
    isDetecting,
    detectPlatform,
  };
}

/**
 * Hook for managing video session lifecycle
 */
export function useVideoSession(platform?: VideoPlatform) {
  const [session, setSession] = useState<VideoSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSession = useCallback(async (platformToUse?: VideoPlatform) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await fetch('/api/video-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          platform: platformToUse || platform || 'auto',
          url: window.location.href,
        }),
      });
      
      if (!res.ok) {
        const data = await res.json();
        // If session already exists, use it
        if (data.session) {
          setSession(data.session);
          return data.session;
        }
        throw new Error(data.error || 'Failed to start session');
      }
      
      const data = await res.json();
      setSession(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [platform]);

  const endSession = useCallback(async () => {
    if (!session) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/video-sessions/${session.id}`, {
        method: 'DELETE',
      });
      
      if (!res.ok) {
        throw new Error('Failed to end session');
      }
      
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end session');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  // Check for active session on mount
  useEffect(() => {
    async function checkActiveSession() {
      try {
        const res = await fetch('/api/video-sessions');
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setSession(data.session);
          }
        }
      } catch (error) {
        console.error('Failed to check active session:', error);
      }
    }
    
    checkActiveSession();
  }, []);

  return {
    session,
    isLoading,
    error,
    startSession,
    endSession,
    hasActiveSession: !!session,
  };
}
