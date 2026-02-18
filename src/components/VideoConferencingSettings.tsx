'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/browser';
import type { VideoConferencingSettings, VideoPlatform } from '@/lib/videoConferencingTypes';

interface Props {
  initial?: VideoConferencingSettings | null;
}

export function VideoConferencingSettings({ initial }: Props) {
  const supabase = createClient();
  const [settings, setSettings] = useState<VideoConferencingSettings | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch settings on mount if not provided
  useEffect(() => {
    if (initial !== undefined) return;
    
    async function fetchSettings() {
      try {
        const res = await fetch('/api/settings/video-conferencing');
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
        }
      } catch (err) {
        console.error('Error fetching settings:', err);
      } finally {
        setLoading(false);
      }
    }
    
    fetchSettings();
  }, [initial]);

  const handleSave = useCallback(async (updates: Partial<VideoConferencingSettings>) => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    
    try {
      const res = await fetch('/api/settings/video-conferencing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      
      if (!res.ok) {
        throw new Error('Failed to save settings');
      }
      
      const updated = await res.json();
      setSettings(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  }, []);

  const togglePlatform = (platform: 'zoom' | 'google_meet' | 'ms_teams', enabled: boolean) => {
    handleSave({ [`${platform}_enabled`]: enabled });
  };

  const toggleAutoCapture = (platform: 'zoom' | 'google_meet' | 'ms_teams', enabled: boolean) => {
    handleSave({ [`${platform}_auto_capture`]: enabled });
  };

  const toggleScreenShareDetection = (platform: 'zoom' | 'google_meet' | 'ms_teams', enabled: boolean) => {
    handleSave({ [`${platform}_screen_share_detection`]: enabled });
  };

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">Video Conferencing</h2>
          <p className="help">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">Video Conferencing</h2>
          <p className="help">Unable to load settings</p>
        </div>
      </div>
    );
  }

  const platforms = [
    {
      key: 'zoom' as const,
      name: 'Zoom',
      icon: '📹',
      enabled: settings.zoom_enabled,
      autoCapture: settings.zoom_auto_capture,
      screenShareDetection: settings.zoom_screen_share_detection,
    },
    {
      key: 'google_meet' as const,
      name: 'Google Meet',
      icon: '📹',
      enabled: settings.google_meet_enabled,
      autoCapture: settings.google_meet_auto_capture,
      screenShareDetection: settings.google_meet_screen_share_detection,
    },
    {
      key: 'ms_teams' as const,
      name: 'Microsoft Teams',
      icon: '📹',
      enabled: settings.ms_teams_enabled,
      autoCapture: settings.ms_teams_auto_capture,
      screenShareDetection: settings.ms_teams_screen_share_detection,
    },
  ];

  return (
    <div className="card">
      <div className="cardInner stack">
        <h2 className="cardTitle">Video Conferencing Integrations</h2>
        <p className="help">
          Configure integration with Zoom, Google Meet, and Microsoft Teams for 
          automated screen share detection and audio capture during interviews.
        </p>
        
        {error && (
          <div className="error-banner" style={{ 
            padding: '12px', 
            background: '#fee2e2', 
            borderRadius: '6px',
            color: '#dc2626'
          }}>
            {error}
          </div>
        )}
        
        {success && (
          <div className="success-banner" style={{ 
            padding: '12px', 
            background: '#dcfce7', 
            borderRadius: '6px',
            color: '#16a34a'
          }}>
            Settings saved successfully!
          </div>
        )}
        
        {/* General Settings */}
        <div className="settings-section">
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
            General Settings
          </h3>
          
          <div className="toggle-group" style={{ gap: '12px' }}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.audio_capture_enabled}
                onChange={(e) => handleSave({ audio_capture_enabled: e.target.checked })}
                disabled={saving}
              />
              <span>Enable audio capture</span>
            </label>
            
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.screen_share_detection_enabled}
                onChange={(e) => handleSave({ screen_share_detection_enabled: e.target.checked })}
                disabled={saving}
              />
              <span>Enable screen share detection</span>
            </label>
            
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.auto_detect_platform}
                onChange={(e) => handleSave({ auto_detect_platform: e.target.checked })}
                disabled={saving}
              />
              <span>Auto-detect platform from URL</span>
            </label>
          </div>
          
          <div style={{ marginTop: '12px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>
              Preferred platform
            </label>
            <select
              value={settings.preferred_platform}
              onChange={(e) => handleSave({ preferred_platform: e.target.value as VideoPlatform })}
              disabled={saving}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #e5e7eb',
                fontSize: '14px',
              }}
            >
              <option value="auto">Auto-detect</option>
              <option value="zoom">Zoom</option>
              <option value="google_meet">Google Meet</option>
              <option value="ms_teams">Microsoft Teams</option>
            </select>
          </div>
        </div>
        
        {/* Platform-specific Settings */}
        <div className="settings-section" style={{ marginTop: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
            Platform Integrations
          </h3>
          
          {platforms.map((platform) => (
            <div 
              key={platform.key}
              style={{
                padding: '16px',
                background: '#f9fafb',
                borderRadius: '8px',
                marginBottom: '12px',
              }}
            >
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <span style={{ fontWeight: 600 }}>{platform.icon} {platform.name}</span>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={platform.enabled}
                    onChange={(e) => togglePlatform(platform.key, e.target.checked)}
                    disabled={saving}
                  />
                  <span>Enabled</span>
                </label>
              </div>
              
              {platform.enabled && (
                <div className="platform-options" style={{ 
                  display: 'flex', 
                  flexDirection: 'column',
                  gap: '8px',
                  paddingLeft: '12px',
                  borderLeft: '2px solid #e5e7eb'
                }}>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={platform.autoCapture}
                      onChange={(e) => toggleAutoCapture(platform.key, e.target.checked)}
                      disabled={saving}
                    />
                    <span>Auto-start audio capture when joining</span>
                  </label>
                  
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={platform.screenShareDetection}
                      onChange={(e) => toggleScreenShareDetection(platform.key, e.target.checked)}
                      disabled={saving}
                    />
                    <span>Detect screen share events</span>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
        
        {/* Audio Settings */}
        <div className="settings-section" style={{ marginTop: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
            Audio Settings
          </h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>
                Sample Rate (Hz)
              </label>
              <select
                value={settings.audio_sample_rate}
                onChange={(e) => handleSave({ audio_sample_rate: parseInt(e.target.value) })}
                disabled={saving}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  fontSize: '14px',
                }}
              >
                <option value="8000">8000</option>
                <option value="16000">16000</option>
                <option value="44100">44100</option>
                <option value="48000">48000</option>
              </select>
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>
                Channels
              </label>
              <select
                value={settings.audio_channels}
                onChange={(e) => handleSave({ audio_channels: parseInt(e.target.value) })}
                disabled={saving}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  fontSize: '14px',
                }}
              >
                <option value="1">Mono</option>
                <option value="2">Stereo</option>
              </select>
            </div>
          </div>
        </div>
        
        <div style={{ marginTop: '16px', fontSize: '12px', color: '#6b7280' }}>
          <p>
            Note: Audio capture requires explicit user permission and is only activated 
            during active interview sessions. All audio data is processed locally and 
            with your consent.
          </p>
        </div>
      </div>
    </div>
  );
}
