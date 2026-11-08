'use client';

import { useEffect, useId, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { CheckIcon, CloseIcon, PlusIcon } from '@/components/icons';
import { Skeleton } from '@/components/Skeleton';
import {
  GroupFooter,
  SaveNote,
  SettingRow,
  SettingsGroup,
  settingsStyles as styles,
  type SaveState,
} from '@/app/[locale]/settings/SettingsUI';

type ProfileData = {
  id: string;
  email: string | null;
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
 * Profile and Language & region both read /api/settings/profile and mount
 * together: they share one request.
 */
let profileRequest: Promise<ProfileData | null> | null = null;
function loadProfile(): Promise<ProfileData | null> {
  if (!profileRequest) {
    const request = fetch('/api/settings/profile')
      .then(async (res) => (res.ok ? (((await res.json().catch(() => null))?.profile ?? null) as ProfileData | null) : null))
      .catch(() => null);
    profileRequest = request;
    void request.finally(() => {
      if (profileRequest === request) profileRequest = null;
    });
  }
  return profileRequest;
}

async function saveProfile(patch: Partial<Pick<ProfileData, 'full_name' | 'avatar_url' | 'target_roles' | 'timezone'>>) {
  const res = await fetch('/api/settings/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/**
 * "Hora del este de Norteamérica (New York)": the zone's name in the app's
 * language, from the browser. These rows render only in the browser (after
 * the profile loads), so server and browser never disagree about the wording.
 */
function timeZoneLabel(timeZone: string, locale: string): string {
  try {
    // UTC has no generic name ("GMT+00:00"); its long name is "Coordinated Universal Time".
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: timeZone === 'UTC' ? 'long' : 'longGeneric' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!name) return timeZone;
    const city = timeZone.includes('/') ? timeZone.split('/').pop()!.replace(/_/g, ' ') : null;
    return city ? `${name} (${city})` : name;
  } catch {
    return timeZone;
  }
}

function sameRoles(a: string[], b: string[]) {
  return a.length === b.length && a.every((role, i) => role === b[i]);
}

const isWebAddress = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

/** Settings → Profile: email (read only), name, photo and target roles, saved with one button. */
export function ProfileSettings({ email }: { email?: string | null }) {
  const t = useTranslations('ProfileSettings');
  const ids = { name: useId(), avatar: useId(), roles: useId(), rolesHelp: useId(), custom: useId() };
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saved, setSaved] = useState<ProfileData | null>(null);
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [customRole, setCustomRole] = useState('');
  const [state, setState] = useState<SaveState>('idle');
  const [avatarBroken, setAvatarBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadProfile().then((profile) => {
      if (cancelled) return;
      if (profile) {
        setSaved(profile);
        setFullName(profile.full_name ?? '');
        setAvatarUrl(profile.avatar_url ?? '');
        setTargetRoles(profile.target_roles ?? []);
      } else {
        setLoadFailed(true);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const commonLabels = COMMON_ROLES.map((key) => t(`roles.${key}`));
  const customRoles = targetRoles.filter((role) => !commonLabels.includes(role));
  const atMax = targetRoles.length >= MAX_ROLES;
  const dirty =
    saved !== null &&
    (fullName !== (saved.full_name ?? '') || avatarUrl !== (saved.avatar_url ?? '') || !sameRoles(targetRoles, saved.target_roles ?? []));

  function edited() {
    if (state !== 'saving') setState('idle');
  }

  function toggleRole(role: string) {
    setTargetRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
    edited();
  }

  function addCustomRole() {
    const role = customRole.trim();
    if (!role || atMax) return;
    if (!targetRoles.includes(role)) setTargetRoles((prev) => [...prev, role]);
    setCustomRole('');
    edited();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    setState('saving');
    const next = { full_name: fullName.trim() || null, avatar_url: avatarUrl.trim() || null, target_roles: targetRoles };
    if (await saveProfile(next)) {
      setSaved((current) => (current ? { ...current, ...next } : current));
      setFullName(next.full_name ?? '');
      setAvatarUrl(next.avatar_url ?? '');
      setState('saved');
    } else {
      setState('error');
    }
  }

  if (loading) {
    return (
      <SettingsGroup>
        <div className={styles.skeletonRows} role="status" aria-label={t('loading')}>
          <Skeleton width="30%" height="14px" />
          <Skeleton width="100%" height="40px" borderRadius="8px" />
          <Skeleton width="30%" height="14px" />
          <Skeleton width="100%" height="40px" borderRadius="8px" />
        </div>
      </SettingsGroup>
    );
  }

  const shownEmail = saved?.email || email || '';

  return (
    <form className={styles.group} onSubmit={save}>
      {loadFailed ? (
        <div className={styles.block}>
          <p className={styles.inlineError} role="alert">
            {t('loadFailed')}
          </p>
        </div>
      ) : null}

      <SettingRow label={t('email')} help={t('emailHelp')}>
        <span className={styles.rowValue}>{shownEmail}</span>
      </SettingRow>

      <SettingRow label={t('fullName')} htmlFor={ids.name}>
        <input
          id={ids.name}
          className="input"
          type="text"
          autoComplete="name"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            edited();
          }}
          maxLength={100}
        />
      </SettingRow>

      <SettingRow label={t('avatar')} htmlFor={ids.avatar}>
        <div className={styles.avatarField}>
          {isWebAddress(avatarUrl) && !avatarBroken ? (
            <Image
              src={avatarUrl.trim()}
              alt={t('avatarPreview')}
              width={32}
              height={32}
              unoptimized
              className={styles.avatarPreview}
              onError={() => setAvatarBroken(true)}
            />
          ) : null}
          <input
            id={ids.avatar}
            className="input"
            type="url"
            inputMode="url"
            value={avatarUrl}
            onChange={(e) => {
              setAvatarUrl(e.target.value);
              setAvatarBroken(false);
              edited();
            }}
            placeholder={t('avatarPlaceholder')}
          />
        </div>
      </SettingRow>

      <SettingRow
        layout="stacked"
        label={t('targetRoles')}
        labelId={ids.roles}
        help={t('targetRolesHelp', { max: MAX_ROLES })}
        helpId={ids.rolesHelp}
        aside={<span className={styles.count}>{t('selected', { count: targetRoles.length, max: MAX_ROLES })}</span>}
      >
        <div className={styles.rolesControl}>
          <div className={styles.chips} role="group" aria-labelledby={ids.roles} aria-describedby={ids.rolesHelp}>
            {commonLabels.map((role) => {
              const selected = targetRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  className={styles.chip}
                  onClick={() => toggleRole(role)}
                  disabled={atMax && !selected}
                  aria-pressed={selected}
                >
                  {selected ? <CheckIcon size={14} /> : null}
                  {role}
                </button>
              );
            })}
            {customRoles.map((role) => (
              <span key={role} className={`${styles.chip} ${styles.chipCustom}`}>
                {role}
                <button type="button" className={styles.chipRemove} onClick={() => toggleRole(role)} aria-label={t('removeRole', { role })}>
                  <CloseIcon size={14} />
                </button>
              </span>
            ))}
          </div>
          <div className={styles.addRole}>
            <input
              id={ids.custom}
              className="input"
              type="text"
              value={customRole}
              onChange={(e) => setCustomRole(e.target.value)}
              placeholder={t('customRole')}
              aria-label={t('customRole')}
              maxLength={120}
              disabled={atMax}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustomRole();
                }
              }}
            />
            <button type="button" className="button" onClick={addCustomRole} disabled={!customRole.trim() || atMax}>
              <PlusIcon size={16} />
              {t('add')}
            </button>
          </div>
        </div>
      </SettingRow>

      <GroupFooter>
        <SaveNote state={state} saved={t('saved')} error={t('saveFailed')} />
        <button className="button buttonPrimary" type="submit" disabled={!dirty || state === 'saving'}>
          {state === 'saving' ? t('saving') : t('save')}
        </button>
      </GroupFooter>
    </form>
  );
}

/** Settings → Language & region → Time zone. Saved as soon as it changes. */
export function TimeZoneSetting() {
  const t = useTranslations('ProfileSettings');
  const locale = useLocale();
  const id = useId();
  const [zone, setZone] = useState<string | null>(null);
  const [deviceZone, setDeviceZone] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>('idle');

  useEffect(() => {
    let cancelled = false;
    void loadProfile().then((profile) => {
      if (cancelled) return;
      setZone(profile?.timezone || 'UTC');
      try {
        setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
      } catch {
        setDeviceZone(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state !== 'saved') return;
    const timer = window.setTimeout(() => setState('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function change(next: string) {
    const previous = zone;
    setZone(next);
    setState('saving');
    if (await saveProfile({ timezone: next })) {
      setState('saved');
    } else {
      setZone(previous);
      setState('error');
    }
  }

  // The saved zone and this device's zone are always offered, even when they aren't in the short list.
  const zones = [...TIMEZONES];
  for (const extra of [zone, deviceZone]) if (extra && !zones.includes(extra)) zones.push(extra);

  return (
    <>
      <SettingRow label={t('timezone')} help={t('timezoneHelp')} htmlFor={id}>
        {zone === null ? (
          <Skeleton width="100%" height="40px" borderRadius="8px" />
        ) : (
          <select id={id} className="select" value={zone} onChange={(e) => void change(e.target.value)} disabled={state === 'saving'}>
            {zones.map((tz) => (
              <option key={tz} value={tz}>
                {timeZoneLabel(tz, locale)}
              </option>
            ))}
          </select>
        )}
      </SettingRow>
      <SaveNote state={state} saved={t('saved')} error={t('timezoneFailed')} inSection />
    </>
  );
}
