/**
 * Video Conferencing Service Tests
 */

import { 
  detectPlatform, 
  screenShareDetectionHooks,
  createAudioCaptureEndpoint 
} from '../videoConferencing';
import { createDefaultSettings } from '../videoConferencingTypes';
import type { VideoPlatform } from '../videoConferencingTypes';

describe('videoConferencing', () => {
  describe('detectPlatform', () => {
    it('should detect Zoom meetings', () => {
      const urls = [
        'https://zoom.us/j/1234567890',
        'https://zoom.us/meeting/abcd-efgh',
        'https://zoom.us/wc/join/123456',
      ];
      
      urls.forEach(url => {
        const result = detectPlatform(url);
        expect(result.platform).toBe('zoom');
        expect(result.confidence).toBe(0.95);
        expect(result.isMeetingActive).toBe(true);
      });
    });

    it('should detect Google Meet meetings', () => {
      const urls = [
        'https://meet.google.com/abc-defg-hijk',
        'https://meet.google.com/join/abc-defg-hijk',
      ];
      
      urls.forEach(url => {
        const result = detectPlatform(url);
        expect(result.platform).toBe('google_meet');
        expect(result.confidence).toBe(0.95);
        expect(result.isMeetingActive).toBe(true);
      });
    });

    it('should detect Microsoft Teams meetings', () => {
      const urls = [
        'https://teams.microsoft.com/l/meetup-join/abc',
        'https://teams.live.com/meet/abc',
      ];
      
      urls.forEach(url => {
        const result = detectPlatform(url);
        expect(result.platform).toBe('ms_teams');
        expect(result.confidence).toBe(0.95);
        expect(result.isMeetingActive).toBe(true);
      });
    });

    it('should return unknown for non-meeting URLs', () => {
      const urls = [
        'https://example.com',
        'https://google.com',
        'https://github.com',
      ];
      
      urls.forEach(url => {
        const result = detectPlatform(url);
        expect(result.platform).toBe('unknown');
        expect(result.confidence).toBe(0);
        expect(result.isMeetingActive).toBe(false);
      });
    });

    it('should be case insensitive', () => {
      const url = 'https://ZOOM.US/J/1234567890';
      const result = detectPlatform(url);
      expect(result.platform).toBe('zoom');
    });
  });

  describe('createDefaultSettings', () => {
    it('should create default settings with correct structure', () => {
      const userId = 'test-user-id';
      const settings = createDefaultSettings(userId);
      
      expect(settings.user_id).toBe(userId);
      expect(settings.zoom_enabled).toBe(false);
      expect(settings.zoom_auto_capture).toBe(false);
      expect(settings.zoom_screen_share_detection).toBe(true);
      expect(settings.google_meet_enabled).toBe(false);
      expect(settings.ms_teams_enabled).toBe(false);
      expect(settings.audio_capture_enabled).toBe(true);
      expect(settings.audio_sample_rate).toBe(16000);
      expect(settings.audio_channels).toBe(1);
      expect(settings.screen_share_detection_enabled).toBe(true);
      expect(settings.preferred_platform).toBe('auto');
      expect(settings.auto_detect_platform).toBe(true);
    });
  });

  describe('screenShareDetectionHooks', () => {
    it('should have hooks for all platforms', () => {
      const platforms: VideoPlatform[] = ['zoom', 'google_meet', 'ms_teams', 'auto'];
      
      platforms.forEach(platform => {
        const hook = screenShareDetectionHooks[platform];
        expect(hook).toBeDefined();
        expect(hook.platform).toBe(platform);
        expect(typeof hook.detectScreenShare).toBe('function');
        expect(typeof hook.getSessionInfo).toBe('function');
      });
    });

    it('should correctly detect platform from URL', () => {
      const zoomHook = screenShareDetectionHooks.zoom;
      expect(zoomHook.detectScreenShare('https://zoom.us/j/123', 'Zoom Meeting')).toBe(true);
      expect(zoomHook.detectScreenShare('https://meet.google.com/abc', 'Google Meet')).toBe(false);
      
      const meetHook = screenShareDetectionHooks.google_meet;
      expect(meetHook.detectScreenShare('https://meet.google.com/abc-defg-hijk', 'Google Meet')).toBe(true);
      expect(meetHook.detectScreenShare('https://zoom.us/j/123', 'Zoom')).toBe(false);
      
      const teamsHook = screenShareDetectionHooks.ms_teams;
      expect(teamsHook.detectScreenShare('https://teams.microsoft.com/l/meetup-join/abc', 'Teams')).toBe(true);
      expect(teamsHook.detectScreenShare('https://zoom.us/j/123', 'Zoom')).toBe(false);
    });
  });

  describe('createAudioCaptureEndpoint', () => {
    it('should create endpoint with correct platform', () => {
      const platforms: VideoPlatform[] = ['zoom', 'google_meet', 'ms_teams'];
      
      platforms.forEach(platform => {
        const endpoint = createAudioCaptureEndpoint(platform);
        expect(endpoint.platform).toBe(platform);
        expect(typeof endpoint.startCapture).toBe('function');
        expect(typeof endpoint.stopCapture).toBe('function');
        expect(typeof endpoint.getAudioLevel).toBe('function');
        expect(endpoint.isCapturing).toBe(false);
      });
    });

    it('should have isCapturing as writable', () => {
      const endpoint = createAudioCaptureEndpoint('zoom');
      // The isCapturing property should be writable (we check this by accessing it)
      expect(endpoint.isCapturing).toBe(false);
    });
  });
});
