'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePushNotifications } from '@/components/ServiceWorkerProvider';
import { Skeleton } from '@/components/Skeleton';
import {
  GroupFooter,
  SaveNote,
  SettingRow,
  settingsStyles as styles,
  type SaveState,
} from '@/app/[locale]/settings/SettingsUI';

type Preferences = {
  email_interview_reminders: boolean;
  email_application_updates: boolean;
  email_ai_suggestions: boolean;
  email_weekly_digest: boolean;
  in_app_interview_reminders: boolean;
  in_app_application_updates: boolean;
  in_app_ai_suggestions: boolean;
};

const DEFAULTS: Preferences = {
  email_interview_reminders: true,
  email_application_updates: true,
  email_ai_suggestions: true,
  email_weekly_digest: false,
  in_app_interview_reminders: true,
  in_app_application_updates: true,
  in_app_ai_suggestions: true,
};

const KINDS = ['interview_reminders', 'application_updates', 'ai_suggestions'] as const;

const same = (a: Preferences, b: Preferences) => (Object.keys(a) as Array<keyof Preferences>).every((key) => a[key] === b[key]);

/**
 * Settings → Notifications: what Apex Round tells you about (rows) and where
 * (in the app, by email), plus notifications on this device. Delivery happens
 * in src/lib/notify.ts.
 */
export function NotificationPreferences({ email, emailConfigured }: { email: string | null; emailConfigured: boolean }) {
  const t = useTranslations('NotificationPreferences');
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [baseline, setBaseline] = useState<Preferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<SaveState>('idle');
  const [pushError, setPushError] = useState(false);
  const push = usePushNotifications();
  const base = useId();
  const col = { inApp: `${base}-in-app`, email: `${base}-email` };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/notifications/preferences');
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && json.preferences) {
          const loaded = { ...DEFAULTS, ...json.preferences } as Preferences;
          setPreferences(loaded);
          setBaseline(loaded);
        }
      } catch {
        // The defaults stay; saving still works.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = !same(preferences, baseline);

  function toggle(key: keyof Preferences) {
    setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
    if (state !== 'saving') setState('idle');
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    setState('saving');
    try {
      const sent = preferences;
      const res = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(sent),
      });
      if (!res.ok) throw new Error();
      setBaseline(sent);
      setState('saved');
    } catch {
      setState('error');
    }
  }

  async function togglePush() {
    setPushError(false);
    try {
      if (push.state === 'on') await push.disable();
      else await push.enable();
    } catch {
      setPushError(true);
    }
  }

  const checkbox = (key: keyof Preferences, labelledBy: string) => (
    <input type="checkbox" checked={preferences[key]} onChange={() => toggle(key)} aria-labelledby={labelledBy} disabled={loading} />
  );

  return (
    <form className={styles.group} onSubmit={save} id="notification-preferences">
      {loading ? (
        <div className={styles.skeletonRows} role="status" aria-label={t('loading')}>
          <Skeleton width="45%" height="14px" />
          <Skeleton width="70%" height="12px" />
          <Skeleton width="45%" height="14px" />
          <Skeleton width="70%" height="12px" />
        </div>
      ) : (
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th scope="col">
                <span className="srOnly">{t('kind')}</span>
              </th>
              <th scope="col" id={col.inApp} className={styles.channel}>
                {t('inApp')}
              </th>
              <th scope="col" id={col.email} className={styles.channel}>
                {t('byEmail')}
              </th>
            </tr>
          </thead>
          <tbody>
            {KINDS.map((kind) => (
              <tr key={kind}>
                <th scope="row">
                  <span id={`${base}-${kind}`} className={styles.rowLabel}>
                    {t(`kinds.${kind}.label`)}
                  </span>
                  <span className={styles.rowHelp}>{t(`kinds.${kind}.when`)}</span>
                </th>
                <td className={styles.channel}>{checkbox(`in_app_${kind}`, `${base}-${kind} ${col.inApp}`)}</td>
                <td className={styles.channel}>{checkbox(`email_${kind}`, `${base}-${kind} ${col.email}`)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">
                <span id={`${base}-digest`} className={styles.rowLabel}>
                  {t('digest')}
                </span>
                <span className={styles.rowHelp}>{t('digestHelp')}</span>
              </th>
              <td className={styles.channel} />
              <td className={styles.channel}>{checkbox('email_weekly_digest', `${base}-digest ${col.email}`)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <SettingRow
        layout="inline"
        label={t('device')}
        help={pushError ? t('pushFailed') : t(`push.${push.state}`)}
        helpLive
      >
        {push.state === 'on' || push.state === 'off' ? (
          <button type="button" className="button" onClick={() => void togglePush()} disabled={push.busy}>
            {push.busy ? t('working') : push.state === 'on' ? t('pushOff') : t('pushOn')}
          </button>
        ) : null}
      </SettingRow>

      <GroupFooter note={emailConfigured ? (email ? t('sentTo', { email }) : t('sentToAccount')) : t('emailUnconfigured')}>
        <SaveNote state={state} saved={t('saved')} error={t('notSaved')} />
        <button type="submit" className="button buttonPrimary" disabled={!dirty || state === 'saving' || loading}>
          {state === 'saving' ? t('saving') : t('save')}
        </button>
      </GroupFooter>
    </form>
  );
}
