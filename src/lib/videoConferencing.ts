/**
 * Video Conferencing Service
 * 
 * Core service for managing video conferencing integrations with
 * Zoom, Google Meet, and Microsoft Teams.
 * 
 * Handles:
 * - Platform detection
 * - Audio capture endpoints
 * - Screen share detection hooks
 * - Settings management
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { 
  VideoConferencingSettings, 
  VideoSession, 
  VideoPlatform,
  PlatformDetectionResult,
  ScreenShareDetectionHook,
  AudioCaptureEndpoint
} from './videoConferencingTypes';
import { createDefaultSettings } from './videoConferencingTypes';

// Platform detection patterns
const PLATFORM_PATTERNS = {
  zoom: [
    /zoom\.us\/j\/\d+/i,
    /zoom\.us\/meeting/i,
    /zoom\.us\/wc/i,
  ],
  google_meet: [
    /meet\.google\.com\/[a-z]{3}-[a-z]{3,4}-[a-z]{3}/i,
    /meet\.google\.com\/join/i,
  ],
  ms_teams: [
    /teams\.microsoft\.com\/l\/meetup-join/i,
    /teams\.live\.com\/meet/i,
  ],
};

/**
 * Detect which video conferencing platform is active
 * based on URL patterns
 */
export function detectPlatform(url: string): PlatformDetectionResult {
  const lowerUrl = url.toLowerCase();
  
  for (const pattern of PLATFORM_PATTERNS.zoom) {
    if (pattern.test(lowerUrl)) {
      return {
        platform: 'zoom',
        confidence: 0.95,
        isMeetingActive: true,
      };
    }
  }
  
  for (const pattern of PLATFORM_PATTERNS.google_meet) {
    if (pattern.test(lowerUrl)) {
      return {
        platform: 'google_meet',
        confidence: 0.95,
        isMeetingActive: true,
      };
    }
  }
  
  for (const pattern of PLATFORM_PATTERNS.ms_teams) {
    if (pattern.test(lowerUrl)) {
      return {
        platform: 'ms_teams',
        confidence: 0.95,
        isMeetingActive: true,
      };
    }
  }
  
  return {
    platform: 'unknown',
    confidence: 0,
    isMeetingActive: false,
  };
}

/**
 * Get user video conferencing settings
 */
export async function getVideoConferencingSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<VideoConferencingSettings | null> {
  const { data, error } = await supabase
    .from('video_conferencing_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      // No settings found, return null
      return null;
    }
    throw error;
  }
  
  return data;
}

/**
 * Create default video conferencing settings for a user
 */
export async function createVideoConferencingSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<VideoConferencingSettings> {
  const defaultSettings = createDefaultSettings(userId);
  
  const { data, error } = await supabase
    .from('video_conferencing_settings')
    .insert(defaultSettings)
    .select()
    .single();
  
  if (error) throw error;
  
  return data;
}

/**
 * Update video conferencing settings
 */
export async function updateVideoConferencingSettings(
  supabase: SupabaseClient,
  userId: string,
  updates: Partial<VideoConferencingSettings>
): Promise<VideoConferencingSettings> {
  const { data, error } = await supabase
    .from('video_conferencing_settings')
    .update(updates)
    .eq('user_id', userId)
    .select()
    .single();
  
  if (error) throw error;
  
  return data;
}

/**
 * Create a new video session record
 */
export async function createVideoSession(
  supabase: SupabaseClient,
  userId: string,
  platform: VideoPlatform | 'unknown',
  sessionInfo?: {
    platformSessionId?: string;
    sessionTitle?: string;
    participantCount?: number;
  }
): Promise<VideoSession> {
  const { data, error } = await supabase
    .from('video_sessions')
    .insert({
      user_id: userId,
      platform,
      platform_session_id: sessionInfo?.platformSessionId ?? null,
      session_title: sessionInfo?.sessionTitle ?? null,
      participant_count: sessionInfo?.participantCount ?? null,
      status: 'active',
    })
    .select()
    .single();
  
  if (error) throw error;
  
  return data;
}

/**
 * Update video session state (screen share / audio capture)
 */
export async function updateVideoSessionState(
  supabase: SupabaseClient,
  sessionId: string,
  updates: {
    screen_share_active?: boolean;
    screen_share_started_at?: string;
    screen_share_ended_at?: string;
    screen_share_duration_seconds?: number;
    audio_capture_active?: boolean;
    audio_capture_started_at?: string;
    audio_capture_ended_at?: string;
    audio_capture_duration_seconds?: number;
    status?: 'active' | 'ended' | 'error';
    session_title?: string;
    participant_count?: number;
  }
): Promise<VideoSession> {
  const { data, error } = await supabase
    .from('video_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single();
  
  if (error) throw error;
  
  return data;
}

/**
 * End a video session
 */
export async function endVideoSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<VideoSession> {
  const endedAt = new Date().toISOString();
  
  const { data: session } = await supabase
    .from('video_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  
  if (!session) throw new Error('Session not found');
  
  // Calculate durations if sessions were active
  const updates: Record<string, unknown> = {
    status: 'ended',
    ended_at: endedAt,
  };
  
  if (session.screen_share_active && session.screen_share_started_at) {
    const startTime = new Date(session.screen_share_started_at).getTime();
    const endTime = new Date(endedAt).getTime();
    updates.screen_share_ended_at = endedAt;
    updates.screen_share_duration_seconds = Math.floor((endTime - startTime) / 1000);
    updates.screen_share_active = false;
  }
  
  if (session.audio_capture_active && session.audio_capture_started_at) {
    const startTime = new Date(session.audio_capture_started_at).getTime();
    const endTime = new Date(endedAt).getTime();
    updates.audio_capture_ended_at = endedAt;
    updates.audio_capture_duration_seconds = Math.floor((endTime - startTime) / 1000);
    updates.audio_capture_active = false;
  }
  
  const { data, error } = await supabase
    .from('video_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single();
  
  if (error) throw error;
  
  return data;
}

/**
 * Get active video session for user
 */
export async function getActiveVideoSession(
  supabase: SupabaseClient,
  userId: string
): Promise<VideoSession | null> {
  const { data, error } = await supabase
    .from('video_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }
  
  return data;
}

/**
 * Record screen share event
 */
export async function recordScreenShareEvent(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  eventType: 'started' | 'stopped' | 'pause' | 'resume',
  metadata?: {
    screen_width?: number;
    screen_height?: number;
    source_id?: string;
    source_name?: string;
    duration_seconds?: number;
  }
) {
  const { error } = await supabase
    .from('video_screen_share_events')
    .insert({
      session_id: sessionId,
      user_id: userId,
      event_type: eventType,
      screen_width: metadata?.screen_width ?? null,
      screen_height: metadata?.screen_height ?? null,
      source_id: metadata?.source_id ?? null,
      source_name: metadata?.source_name ?? null,
      duration_seconds: metadata?.duration_seconds ?? null,
    });
  
  if (error) throw error;
}

/**
 * Record audio event
 */
export async function recordAudioEvent(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  eventType: 'start' | 'stop' | 'data' | 'error',
  metadata?: {
    transcript_text?: string;
    duration_ms?: number;
    device_id?: string;
    sample_rate?: number;
    channels?: number;
    format?: string;
  }
) {
  const { error } = await supabase
    .from('video_audio_events')
    .insert({
      session_id: sessionId,
      user_id: userId,
      event_type: eventType,
      transcript_text: metadata?.transcript_text ?? null,
      duration_ms: metadata?.duration_ms ?? null,
      device_id: metadata?.device_id ?? null,
      sample_rate: metadata?.sample_rate ?? null,
      channels: metadata?.channels ?? null,
      format: metadata?.format ?? null,
    });
  
  if (error) throw error;
}

/**
 * Platform-specific screen share detection hooks
 * These can be used in browser context to detect screen share events
 */
export const screenShareDetectionHooks: Record<VideoPlatform, ScreenShareDetectionHook> = {
  zoom: {
    platform: 'zoom',
    detectScreenShare: (windowLocation: string, documentTitle: string) => {
      return detectPlatform(windowLocation).platform === 'zoom';
    },
    getSessionInfo: async () => {
      // Zoom-specific session info extraction
      return {
        sessionId: null,
        sessionTitle: document.title.replace('Zoom Meeting', '').trim() || null,
        participantCount: null,
      };
    },
  },
  google_meet: {
    platform: 'google_meet',
    detectScreenShare: (windowLocation: string, documentTitle: string) => {
      return detectPlatform(windowLocation).platform === 'google_meet';
    },
    getSessionInfo: async () => {
      return {
        sessionId: null,
        sessionTitle: document.title.replace('Google Meet', '').trim() || null,
        participantCount: null,
      };
    },
  },
  ms_teams: {
    platform: 'ms_teams',
    detectScreenShare: (windowLocation: string, documentTitle: string) => {
      return detectPlatform(windowLocation).platform === 'ms_teams';
    },
    getSessionInfo: async () => {
      return {
        sessionId: null,
        sessionTitle: document.title.replace('Microsoft Teams', '').trim() || null,
        participantCount: null,
      };
    },
  },
  auto: {
    platform: 'auto',
    detectScreenShare: (windowLocation: string, documentTitle: string) => {
      const result = detectPlatform(windowLocation);
      return result.isMeetingActive;
    },
    getSessionInfo: async () => {
      return {
        sessionId: null,
        sessionTitle: document.title || null,
        participantCount: null,
      };
    },
  },
};

/**
 * Create audio capture endpoint for a platform
 * Returns browser MediaStream API functions
 */
export function createAudioCaptureEndpoint(platform: VideoPlatform): AudioCaptureEndpoint {
  let capturing = false;
  
  return {
    platform,
    isCapturing: false,
    
    async startCapture(deviceId?: string): Promise<MediaStream> {
      try {
        const constraints: MediaStreamConstraints = {
          audio: deviceId 
            ? { deviceId: { exact: deviceId } }
            : true,
          video: false,
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        capturing = true;
        (this as AudioCaptureEndpoint).isCapturing = true;
        return stream;
      } catch (error) {
        capturing = false;
        (this as AudioCaptureEndpoint).isCapturing = false;
        throw error;
      }
    },
    
    stopCapture(stream: MediaStream): void {
      stream.getTracks().forEach(track => track.stop());
      capturing = false;
      (this as AudioCaptureEndpoint).isCapturing = false;
    },
    
    getAudioLevel(stream: MediaStream): number {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return 0;
      
      // Use Web Audio API to calculate RMS level
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate RMS
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      
      // Normalize to 0-1 range
      return Math.min(rms / 128, 1);
    },
  };
}
