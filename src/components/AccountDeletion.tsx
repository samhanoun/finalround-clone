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
            ✓ Account Deleted
          </h2>
          <p>
            Your account has been permanently deleted. All your data has been removed.
            Redirecting you to the homepage...
          </p>
        </div>
      </div>
    );
  }

  if (!showWarning) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">Delete Account</h2>
          <p className="cardDesc">
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          
          <div 
            style={{ 
              background: 'var(--error-bg)', 
              border: '1px solid var(--error)',
              borderRadius: 8, 
              padding: 16,
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--error)' }}>
              ⚠️ Warning: This will permanently delete:
            </p>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>Your profile and account</li>
              <li>All interview sessions</li>
              <li>All resumes and cover letters</li>
              <li>All usage history and quotas</li>
            </ul>
          </div>

          <button
            className="button"
            onClick={() => setShowWarning(true)}
            style={{ 
              background: 'var(--error)', 
              color: 'white',
              alignSelf: 'flex-start',
            }}
          >
            I Understand, Delete My Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <h2 className="cardTitle" style={{ color: 'var(--error)' }}>
          Confirm Account Deletion
        </h2>
        <p className="cardDesc">
          To confirm deletion, please enter your email address and type &quot;DELETE&quot; below.
        </p>

        <div className="stack" style={{ gap: 16 }}>
          <label className="label">
            Your Email Address
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="label">
            Reason for Leaving (Optional)
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
            className="button"
            onClick={handleDelete}
            disabled={saving || email !== email.toLowerCase() || confirmText !== 'DELETE'}
            style={{ 
              background: 'var(--error)', 
              color: 'white',
            }}
          >
            {saving ? 'Deleting...' : 'Permanently Delete Account'}
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
