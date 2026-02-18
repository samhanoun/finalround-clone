/**
 * Video Conferencing Integration Types
 * 
 * Defines types for Zoom, Google Meet, and Microsoft Teams integrations
 * following the PRD requirements for Live Copilot audio capture and 
 * screen share detection.
 */

export type VideoPlatform = 'zoom' | 'google_meet' | 'ms_teams' | 'auto';

export interface VideoConferencingSettings {
  id: string;
  user_id: string;
  
  // Zoom
  zoom_enabled: boolean;
  zoom_auto_capture: boolean;
  zoom_screen_share_detection: boolean;
  
  // Google Meet
  google_meet_enabled: boolean;
  google_meet_auto_capture: boolean;
  google_meet_screen_share_detection: boolean;
  
  // Microsoft Teams
  ms_teams_enabled: boolean;
  ms_teams_auto_capture: boolean;
  ms_teams_screen_share_detection: boolean;
  
  // Audio capture
  audio_capture_enabled: boolean;
  audio_input_device_id: string | null;
  audio_sample_rate: number;
  audio_channels: number;
  
  // Screen share
  screen_share_detection_enabled: boolean;
  screen_share_callback_url: string | null;
  
  // General
  preferred_platform: VideoPlatform;
  auto_detect_platform: boolean;
  
  created_at: string;
  updated_at: string;
}

export interface VideoSession {
  id: string;
  user_id: string;
  platform: VideoPlatform | 'unknown';
  platform_session_id: string | null;
  detected_at: string;
  session_title: string | null;
  participant_count: number | null;
  
  // Screen share state
  screen_share_active: boolean;
  screen_share_started_at: string | null;
  screen_share_ended_at: string | null;
  screen_share_duration_seconds: number | null;
  
  // Audio capture state
  audio_capture_active: boolean;
  audio_capture_started_at: string | null;
  audio_capture_ended_at: string | null;
  audio_capture_duration_seconds: number | null;
  
  // Status
  status: 'active' | 'ended' | 'error';
  metadata: Record<string, unknown>;
  ended_at: string | null;
  created_at: string;
}

export interface VideoAudioEvent {
  id: string;
  session_id: string;
  user_id: string;
  event_type: 'start' | 'stop' | 'data' | 'error';
  audio_data: ArrayBuffer | null;
  transcript_text: string | null;
  duration_ms: number | null;
  device_id: string | null;
  sample_rate: number | null;
  channels: number | null;
  format: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface VideoScreenShareEvent {
  id: string;
  session_id: string;
  user_id: string;
  event_type: 'started' | 'stopped' | 'pause' | 'resume';
  screen_width: number | null;
  screen_height: number | null;
  source_id: string | null;
  source_name: string | null;
  duration_seconds: number | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Platform-specific detection hooks
 * These interfaces define the contract for platform-specific integrations
 */
export interface ScreenShareDetectionHook {
  platform: VideoPlatform;
  detectScreenShare: (windowLocation: string, documentTitle: string) => boolean;
  getSessionInfo: () => Promise<{
    sessionId: string | null;
    sessionTitle: string | null;
    participantCount: number | null;
  }>;
  onScreenShareStart?: (callback: () => void) => void;
  onScreenShareStop?: (callback: () => void) => void;
}

export interface AudioCaptureEndpoint {
  platform: VideoPlatform;
  startCapture: (deviceId?: string) => Promise<MediaStream>;
  stopCapture: (stream: MediaStream) => void;
  getAudioLevel: (stream: MediaStream) => number;
  isCapturing: boolean;
}

/**
 * Platform detection result
 */
export interface PlatformDetectionResult {
  platform: VideoPlatform | 'unknown';
  confidence: number;
  sessionId?: string;
  sessionTitle?: string;
  isMeetingActive: boolean;
}

/**
 * Default settings factory
 */
export function createDefaultSettings(userId: string): Omit<VideoConferencingSettings, 'id' | 'created_at' | 'updated_at'> {
  return {
    user_id: userId,
    zoom_enabled: false,
    zoom_auto_capture: false,
    zoom_screen_share_detection: true,
    google_meet_enabled: false,
    google_meet_auto_capture: false,
    google_meet_screen_share_detection: true,
    ms_teams_enabled: false,
    ms_teams_auto_capture: false,
    ms_teams_screen_share_detection: true,
    audio_capture_enabled: true,
    audio_input_device_id: null,
    audio_sample_rate: 16000,
    audio_channels: 1,
    screen_share_detection_enabled: true,
    screen_share_callback_url: null,
    preferred_platform: 'auto',
    auto_detect_platform: true,
  };
}
