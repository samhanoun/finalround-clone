'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePushNotifications } from '@/components/ServiceWorkerProvider';

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

/** Settings → Notification preferences. Delivery happens in src/lib/notify.ts. */
export function NotificationPreferences({ email, emailConfigured }: { email: string | null; emailConfigured: boolean }) {
  const t = useTranslations('NotificationPreferences');
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const push = usePushNotifications();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/notifications/preferences');
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && json.preferences) setPreferences({ ...DEFAULTS, ...json.preferences });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(key: keyof Preferences) {
    setPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function save() {
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      if (!res.ok) throw new Error();
      setMessage({ kind: 'ok', text: t('saved') });
    } catch {
      setMessage({ kind: 'error', text: t('notSaved') });
    } finally {
      setSaving(false);
    }
  }

  async function togglePush() {
    setMessage(null);
    try {
      if (push.state === 'on') await push.disable();
      else await push.enable();
    } catch {
      setMessage({ kind: 'error', text: t('pushFailed') });
    }
  }

  return (
    <div className="card" id="notifications">
      <div className="cardInner stack">
        <h2 className="cardTitle">{t('title')}</h2>
        <p className="cardDesc">{t('desc')}</p>

        {loading ? (
          <p className="help">{t('loading')}</p>
        ) : (
          <div className="grid2" style={{ alignItems: 'start' }}>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 10 }}>
              <legend className="label">{t('inApp')}</legend>
              {KINDS.map((kind) => (
                <label key={kind} className="checkbox-label" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={preferences[`in_app_${kind}`]} onChange={() => toggle(`in_app_${kind}`)} />
                  <span>
                    {t(`kinds.${kind}.label`)}
                    <span className="help" style={{ display: 'block' }}>
                      {t(`kinds.${kind}.when`)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 10 }}>
              <legend className="label">{t('byEmail')}</legend>
              <p className="help" style={{ margin: 0 }}>
                {emailConfigured ? (email ? t('sentTo', { email }) : t('sentToAccount')) : t('emailUnconfigured')}
              </p>
              {KINDS.map((kind) => (
                <label key={kind} className="checkbox-label">
                  <input type="checkbox" checked={preferences[`email_${kind}`]} onChange={() => toggle(`email_${kind}`)} />
                  <span>{t(`kinds.${kind}.label`)}</span>
                </label>
              ))}
              <label className="checkbox-label" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={preferences.email_weekly_digest} onChange={() => toggle('email_weekly_digest')} />
                <span>
                  {t('digest')}
                  <span className="help" style={{ display: 'block' }}>
                    {t('digestHelp')}
                  </span>
                </span>
              </label>
            </fieldset>
          </div>
        )}

        <hr className="hr" />
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="label">{t('device')}</div>
            <p className="help" style={{ margin: 0 }} role="status">
              {t(`push.${push.state}`)}
            </p>
          </div>
          {push.state === 'on' || push.state === 'off' ? (
            <button type="button" className="button" onClick={() => void togglePush()} disabled={push.busy}>
              {push.busy ? t('working') : push.state === 'on' ? t('pushOff') : t('pushOn')}
            </button>
          ) : null}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 12 }}>
          {message ? (
            <span className="help" role={message.kind === 'error' ? 'alert' : 'status'}>
              {message.text}
            </span>
          ) : null}
          <button type="button" className="button buttonPrimary" onClick={() => void save()} disabled={saving || loading}>
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
