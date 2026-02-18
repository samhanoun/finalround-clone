'use client';

import { useState, useEffect } from 'react';

type NotificationPreferences = {
  email_interview_reminders: boolean;
  email_application_updates: boolean;
  email_ai_suggestions: boolean;
  email_weekly_digest: boolean;
  in_app_interview_reminders: boolean;
  in_app_application_updates: boolean;
  in_app_ai_suggestions: boolean;
};

export function NotificationPreferences() {
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    email_interview_reminders: true,
    email_application_updates: true,
    email_ai_suggestions: true,
    email_weekly_digest: false,
    in_app_interview_reminders: true,
    in_app_application_updates: true,
    in_app_ai_suggestions: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function fetchPreferences() {
      try {
        const res = await fetch('/api/notifications/preferences');
        const json = await res.json();
        if (res.ok && json.preferences) {
          setPreferences(json.preferences);
        }
      } catch (e) {
        console.error('Failed to fetch preferences:', e);
      } finally {
        setLoading(false);
      }
    }
    fetchPreferences();
  }, []);

  function handleChange(key: keyof NotificationPreferences) {
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function save() {
    setError(null);
    setSuccess(false);
    setSaving(true);

    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to save preferences');
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
          <p>Loading preferences...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" id="notifications">
      <div className="cardInner stack">
        <h2 className="cardTitle">Notification preferences</h2>
        <p className="cardDesc">
          Choose how you want to be notified about interview reminders, application updates, and AI suggestions.
        </p>

        <div className="stack" style={{ gap: 16 }}>
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12 }}>In-app notifications</legend>
            <div className="stack" style={{ gap: 8 }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preferences.in_app_interview_reminders}
                  onChange={() => handleChange('in_app_interview_reminders')}
                />
                <span>Interview reminders</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preferences.in_app_application_updates}
                  onChange={() => handleChange('in_app_application_updates')}
                />
                <span>Application updates</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preferences.in_app_ai_suggestions}
                  onChange={() => handleChange('in_app_ai_suggestions')}
                />
                <span>AI suggestions</span>
              </label>
            </div>
          </fieldset>

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', width: '100%' }} />

          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12 }}>Email notifications</legend>
            <div className="stack" style={{ gap: 8 }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preferences.email_interview_reminders}
                  onChange={() => handleChange('email_interview_reminders')}
                />
                <span>Interview reminders</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preferences.email_application_updates}
                  onChange={() => handleChange('email_application_updates')}
                />
                <span>Application updates</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preferences.email_ai_suggestions}
                  onChange={() => handleChange('email_ai_suggestions')}
                />
                <span>AI suggestions</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={preferences.email_weekly_digest}
                  onChange={() => handleChange('email_weekly_digest')}
                />
                <span>Weekly digest</span>
              </label>
            </div>
          </fieldset>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            className="button buttonPrimary"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save preferences'}
          </button>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="success" role="status">
            Preferences saved successfully.
          </div>
        )}
      </div>
    </div>
  );
}
