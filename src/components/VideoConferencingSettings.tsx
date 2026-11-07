'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PLATFORM_LABEL, type MeetingPlatform, type MeetingSettings } from '@/lib/meetingSettings';

const WHERE: Array<{ value: string; platform: MeetingPlatform; desktopApp: boolean }> = [
  { value: 'auto', platform: 'auto', desktopApp: false },
  { value: 'google_meet', platform: 'google_meet', desktopApp: false },
  { value: 'zoom-browser', platform: 'zoom', desktopApp: false },
  { value: 'zoom-app', platform: 'zoom', desktopApp: true },
  { value: 'ms_teams-browser', platform: 'ms_teams', desktopApp: false },
  { value: 'ms_teams-app', platform: 'ms_teams', desktopApp: true },
];

function whereValue(settings: MeetingSettings): string {
  if (settings.platform === 'auto' || settings.platform === 'google_meet') return settings.platform;
  return `${settings.platform}-${settings.desktopApp ? 'app' : 'browser'}`;
}

const TOGGLES = ['askForLink', 'autoStartListening', 'endWhenSharingStops', 'useMicrophone'] as const;

/** Settings → Meeting apps. The live copilot reads these when you open it. */
export function VideoConferencingSettings({ initial }: { initial: MeetingSettings }) {
  const t = useTranslations('MeetingApps');
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const whereId = useId();

  async function save(next: MeetingSettings) {
    const previous = settings;
    setSettings(next);
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/video-conferencing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
      setMessage({ kind: 'ok', text: t('saved') });
    } catch {
      setSettings(previous);
      setMessage({ kind: 'error', text: t('notSaved') });
    } finally {
      setSaving(false);
    }
  }

  const where = WHERE.find((option) => option.value === whereValue(settings)) ?? WHERE[0];

  return (
    <div className="card" id="meeting-apps">
      <div className="cardInner stack">
        <h2 className="cardTitle">{t('title')}</h2>
        <p className="cardDesc">{t('desc')}</p>

        <label className="label" htmlFor={whereId}>
          {t('where')}
          <select
            id={whereId}
            className="select"
            value={where.value}
            disabled={saving}
            onChange={(e) => {
              const choice = WHERE.find((option) => option.value === e.target.value) ?? WHERE[0];
              void save({ ...settings, platform: choice.platform, desktopApp: choice.desktopApp });
            }}
          >
            {WHERE.map((option) => (
              <option key={option.value} value={option.value}>
                {t(`places.${option.value}`)}
              </option>
            ))}
          </select>
          <span className="help">
            {settings.platform === 'auto'
              ? t('whereHelpAuto')
              : settings.desktopApp
                ? t('whereHelpApp', { app: PLATFORM_LABEL[settings.platform] })
                : t('whereHelpTab', { app: PLATFORM_LABEL[settings.platform] })}
          </span>
        </label>

        <div className="stack" style={{ gap: 12 }}>
          {TOGGLES.map((key) => (
            <label key={key} className="checkbox-label" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={settings[key]}
                disabled={saving}
                onChange={(e) => void save({ ...settings, [key]: e.target.checked })}
              />
              <span>
                {t(`toggles.${key}.label`)}
                <span className="help" style={{ display: 'block' }}>
                  {t(`toggles.${key}.help`)}
                </span>
              </span>
            </label>
          ))}
        </div>

        {message ? (
          <p className="help" role={message.kind === 'error' ? 'alert' : 'status'} style={{ margin: 0 }}>
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
