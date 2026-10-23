'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useToastHook } from '@/components/Toast';

/** Creates a practice interview and opens it. */
export function NewPracticeButton({ primary = false, label = 'Practice an interview' }: { primary?: boolean; label?: string }) {
  const router = useRouter();
  const toast = useToastHook();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const statusId = useId();

  async function createInterview() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/interviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Practice interview', status: 'draft', meta: {} }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Could not create a practice interview.');

      toast.success('Practice interview created', 'Your new practice session is ready.');
      router.push(`/interview/${json.session.id}`);
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not create a practice interview.';
      setError(message);
      toast.error('Practice interview not created', message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        className={primary ? 'button buttonPrimary' : 'button'}
        onClick={createInterview}
        disabled={loading}
        type="button"
        aria-describedby={loading ? statusId : error ? errorId : undefined}
      >
        {loading ? 'Creating…' : label}
      </button>
      {loading ? (
        <span id={statusId} className="srOnly">
          Creating a practice interview, please wait…
        </span>
      ) : null}
      {error ? (
        <div className="error" role="alert" id={errorId} style={{ flexBasis: '100%' }}>
          {error}
        </div>
      ) : null}
    </>
  );
}
