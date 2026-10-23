'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AccountDeletion() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  async function handleDelete() {
    setError(null);
    setSaving(true);

    try {
      const res = await fetch('/api/settings/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirm_email: email,
          reason: reason || undefined,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error ?? 'Failed to delete account');
      }

      setSuccess(true);
      
      // Sign out and redirect after a short delay
      setTimeout(async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/');
        router.refresh();
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete account');
    } finally {
      setSaving(false);
    }
  }

  if (success) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle" style={{ color: 'var(--success)' }}>
            Account deleted
          </h2>
          <p>
            Your account has been permanently deleted. All your data has been removed.
            Taking you to the home page…
          </p>
        </div>
      </div>
    );
  }

  if (!showWarning) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">Delete account</h2>
          <p className="cardDesc">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          
          <div 
            style={{ 
              background: 'var(--alert-soft)', 
              border: '1px solid rgba(255, 107, 107, 0.35)',
              borderRadius: 12, 
              padding: 16,
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--alert-text)' }}>
              This permanently deletes:
            </p>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>Your profile and account</li>
              <li>All interview sessions</li>
              <li>All résumés and cover letters</li>
              <li>All usage history and quotas</li>
            </ul>
          </div>

          <button
            className="button buttonDanger"
            onClick={() => setShowWarning(true)}
            style={{ alignSelf: 'flex-start' }}
          >
            Delete my account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <h2 className="cardTitle" style={{ color: 'var(--error)' }}>
          Confirm account deletion
        </h2>
        <p className="cardDesc">
          Enter your email address and type DELETE to confirm.
        </p>

        <div className="stack" style={{ gap: 16 }}>
          <label className="label">
            Your email address
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="label">
            Why are you leaving? (optional)
            <textarea
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What could we have done better?"
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </label>

          <label className="label">
            Type <strong>DELETE</strong> to confirm
            <input
              className="input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
            />
          </label>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            className="button"
            onClick={() => {
              setShowWarning(false);
              setConfirmText('');
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="button buttonDanger"
            onClick={handleDelete}
            disabled={saving || email !== email.toLowerCase() || confirmText !== 'DELETE'}
          >
            {saving ? 'Deleting…' : 'Delete account permanently'}
          </button>
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
