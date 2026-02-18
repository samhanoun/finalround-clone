'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

type ProfileData = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  target_roles: string[] | null;
  language: string;
  timezone: string;
  email_notifications: boolean;
};

const COMMON_ROLES = [
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Developer',
  'DevOps Engineer',
  'Data Scientist',
  'Machine Learning Engineer',
  'Product Manager',
  'UX Designer',
  'Software Engineer',
  'Mobile Developer',
  'Cloud Engineer',
  'Security Engineer',
];

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
];

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function ProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('UTC');
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [customRole, setCustomRole] = useState('');

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch('/api/settings/profile');
        const json = await res.json();
        
        if (res.ok && json.profile) {
          setProfile(json.profile);
          setFullName(json.profile.full_name ?? '');
          setAvatarUrl(json.profile.avatar_url ?? '');
          setTargetRoles(json.profile.target_roles ?? []);
          setLanguage(json.profile.language ?? 'en');
          setTimezone(json.profile.timezone ?? 'UTC');
          setEmailNotifications(json.profile.email_notifications ?? true);
        }
      } catch (e) {
        console.error('Failed to fetch profile:', e);
        setError('Failed to load profile');
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, []);

  function handleRoleToggle(role: string) {
    setTargetRoles(prev => 
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  }

  function handleAddCustomRole() {
    const role = customRole.trim();
    if (role && !targetRoles.includes(role)) {
      setTargetRoles(prev => [...prev, role]);
      setCustomRole('');
    }
  }

  async function save() {
    setError(null);
    setSuccess(false);
    setSaving(true);

    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName || null,
          avatar_url: avatarUrl || null,
          target_roles: targetRoles,
          language,
          timezone,
          email_notifications: emailNotifications,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error ?? 'Failed to save profile');
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p>Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <h2 className="cardTitle">Profile Settings</h2>
        <p className="cardDesc">
          Manage your personal information and job preferences.
        </p>

        <div className="stack" style={{ gap: 16 }}>
          {/* Email (read-only) */}
          <label className="label">
            Email
            <input
              className="input"
              type="email"
              value={profile?.email ?? ''}
              disabled
              aria-readonly
            />
            <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              Email cannot be changed
            </span>
          </label>

          {/* Full Name */}
          <label className="label">
            Full Name
            <input
              className="input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full name"
              maxLength={100}
            />
          </label>

          {/* Avatar URL */}
          <label className="label">
            Avatar URL
            <input
              className="input"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/avatar.jpg"
            />
            {avatarUrl && (
              <Image 
                src={avatarUrl} 
                alt="Avatar preview" 
                width={64}
                height={64}
                style={{ 
                  borderRadius: '50%', 
                  marginTop: 8,
                  objectFit: 'cover'
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
          </label>

          {/* Target Roles */}
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 8 }}>Target Roles</legend>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: 12 }}>
              Select the roles you&apos;re targeting (max 10)
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {COMMON_ROLES.map(role => (
                <button
                  key={role}
                  type="button"
                  className={`button ${targetRoles.includes(role) ? 'buttonPrimary' : ''}`}
                  onClick={() => handleRoleToggle(role)}
                  disabled={targetRoles.length >= 10 && !targetRoles.includes(role)}
                  style={{ fontSize: '0.875rem', padding: '4px 12px' }}
                >
                  {targetRoles.includes(role) && '✓ '}{role}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type="text"
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                placeholder="Add custom role"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomRole();
                  }
                }}
              />
              <button
                type="button"
                className="button"
                onClick={handleAddCustomRole}
                disabled={!customRole.trim()}
              >
                Add
              </button>
            </div>
            {targetRoles.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                  Selected: {targetRoles.length}/10
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {targetRoles.map(role => (
                    <span
                      key={role}
                      style={{
                        background: 'var(--primary)',
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {role}
                      <button
                        type="button"
                        onClick={() => handleRoleToggle(role)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'white',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '1rem',
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </fieldset>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', width: '100%' }} />

          {/* Language */}
          <label className="label">
            Language
            <select
              className="select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGES.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </label>

          {/* Timezone */}
          <label className="label">
            Timezone
            <select
              className="select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>

          {/* Email Notifications */}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={emailNotifications}
              onChange={(e) => setEmailNotifications(e.target.checked)}
            />
            <span>Receive email notifications</span>
          </label>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            className="button buttonPrimary"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="success" role="status">
            Profile saved successfully.
          </div>
        )}
      </div>
    </div>
  );
}
