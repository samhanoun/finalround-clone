'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';

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

/** Suggested roles; the chosen names are saved as shown, in the app's language. */
const COMMON_ROLES = [
  'frontend',
  'backend',
  'fullStack',
  'devops',
  'dataScientist',
  'mlEngineer',
  'productManager',
  'uxDesigner',
  'softwareEngineer',
  'mobile',
  'cloud',
  'security',
] as const;

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

const MAX_ROLES = 10;

/**
 * "Hora del este de Norteamérica (New York)": the zone's name in the app's
 * language, from the browser. This card renders only after it loads, in the
 * browser, so server and browser never disagree about the wording.
 */
function timeZoneLabel(timeZone: string, locale: string): string {
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'longGeneric' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!name) return timeZone;
    const city = timeZone.includes('/') ? timeZone.split('/').pop()!.replace(/_/g, ' ') : null;
    return city ? `${name} (${city})` : name;
  } catch {
    return timeZone;
  }
}

/** Name, avatar, target roles and time zone. The app language has its own card (LanguageSwitcher). */
export function ProfileSettings() {
  const t = useTranslations('ProfileSettings');
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [timezone, setTimezone] = useState('UTC');
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
          setTimezone(json.profile.timezone ?? 'UTC');
        }
      } catch (e) {
        console.error('Failed to fetch profile:', e);
        setError(t('loadFailed'));
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [t]);

  function handleRoleToggle(role: string) {
    setTargetRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  function handleAddCustomRole() {
    const role = customRole.trim();
    if (role && !targetRoles.includes(role)) {
      setTargetRoles((prev) => [...prev, role]);
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
          timezone,
        }),
      });

      if (!res.ok) throw new Error(t('saveFailed'));

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <p>{t('loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <h2 className="cardTitle">{t('title')}</h2>
        <p className="cardDesc">{t('desc')}</p>

        <div className="stack" style={{ gap: 16 }}>
          <label className="label">
            {t('email')}
            <input className="input" type="email" value={profile?.email ?? ''} disabled aria-readonly />
            <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>{t('emailHelp')}</span>
          </label>

          <label className="label">
            {t('fullName')}
            <input
              className="input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('fullNamePlaceholder')}
              maxLength={100}
            />
          </label>

          <label className="label">
            {t('avatar')}
            <input
              className="input"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder={t('avatarPlaceholder')}
            />
            {avatarUrl && (
              <Image
                src={avatarUrl}
                alt={t('avatarPreview')}
                width={64}
                height={64}
                style={{
                  borderRadius: '50%',
                  marginTop: 8,
                  objectFit: 'cover',
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
          </label>

          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 8 }}>{t('targetRoles')}</legend>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: 12 }}>{t('targetRolesHelp', { max: MAX_ROLES })}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {COMMON_ROLES.map((key) => {
                const role = t(`roles.${key}`);
                const selected = targetRoles.includes(role);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`button ${selected ? 'buttonPrimary' : ''}`}
                    onClick={() => handleRoleToggle(role)}
                    disabled={targetRoles.length >= MAX_ROLES && !selected}
                    aria-pressed={selected}
                    style={{ fontSize: '0.875rem', padding: '4px 12px' }}
                  >
                    {selected && '✓ '}
                    {role}
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type="text"
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                placeholder={t('customRole')}
                aria-label={t('customRole')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomRole();
                  }
                }}
              />
              <button type="button" className="button" onClick={handleAddCustomRole} disabled={!customRole.trim()}>
                {t('add')}
              </button>
            </div>
            {targetRoles.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                  {t('selected', { count: targetRoles.length, max: MAX_ROLES })}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {targetRoles.map((role) => (
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
                        aria-label={t('removeRole', { role })}
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

          <label className="label">
            {t('timezone')}
            <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {timeZoneLabel(tz, locale)}
                </option>
              ))}
            </select>
          </label>

          <p className="help" style={{ margin: 0 }}>
            {t('timezoneHelp')}
          </p>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="button buttonPrimary" onClick={save} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </button>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="success" role="status">
            {t('saved')}
          </div>
        )}
      </div>
    </div>
  );
}
