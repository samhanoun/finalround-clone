'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PLATFORM_LABEL, type MeetingPlatform, type MeetingSettings } from '@/lib/meetingSettings';
import { SaveNote, SettingRow, SettingsGroup, Switch, type SaveState } from '@/app/[locale]/settings/SettingsUI';

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

/** Settings → Meeting apps. Each change saves at once; the live copilot reads these when you open it. */
export function VideoConferencingSettings({ initial }: { initial: MeetingSettings }) {
  const t = useTranslations('MeetingApps');
  const [settings, setSettings] = useState(initial);
  const [state, setState] = useState<SaveState>('idle');
  const base = useId();
  const whereId = `${base}-where`;

  useEffect(() => {
    if (state !== 'saved') return;
    const timer = window.setTimeout(() => setState('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function save(next: MeetingSettings) {
    const previous = settings;
    setSettings(next);
    setState('saving');
    try {
      const res = await fetch('/api/settings/video-conferencing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
      setState('saved');
    } catch {
      setSettings(previous);
      setState('error');
    }
  }

  const where = WHERE.find((option) => option.value === whereValue(settings)) ?? WHERE[0];
  const saving = state === 'saving';

  return (
    <SettingsGroup>
      <SettingRow
        label={t('where')}
        htmlFor={whereId}
        help={
          settings.platform === 'auto'
            ? t('whereHelpAuto')
            : settings.desktopApp
              ? t('whereHelpApp', { app: PLATFORM_LABEL[settings.platform] })
              : t('whereHelpTab', { app: PLATFORM_LABEL[settings.platform] })
        }
      >
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
      </SettingRow>

      {TOGGLES.map((key) => (
        <SettingRow
          key={key}
          layout="inline"
          label={t(`toggles.${key}.label`)}
          htmlFor={`${base}-${key}`}
          help={t(`toggles.${key}.help`)}
          helpId={`${base}-${key}-help`}
        >
          <Switch
            id={`${base}-${key}`}
            checked={settings[key]}
            disabled={saving}
            describedBy={`${base}-${key}-help`}
            onChange={(checked) => void save({ ...settings, [key]: checked })}
          />
        </SettingRow>
      ))}

      <SaveNote state={state} saved={t('saved')} error={t('notSaved')} inSection />
    </SettingsGroup>
  );
}
