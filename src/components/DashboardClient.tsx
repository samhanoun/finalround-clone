'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DashboardClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createInterview() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/interviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Interview', status: 'draft', meta: {} }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Failed to create session');
      router.push(`/interview/${json.session.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid2">
        <div className="card">
          <div className="cardInner stack">
            <h2 className="cardTitle">Interview Copilot</h2>
            <p className="cardDesc">Create an interview session, chat, and capture feedback + score.</p>
            <div className="row">
              <button className="button buttonPrimary" onClick={createInterview} disabled={loading} type="button">
                {loading ? 'Creating…' : 'New session'}
              </button>
              <a className="button" href="/dashboard#sessions">
                View sessions
              </a>
            </div>
            {error ? <div className="error">{error}</div> : null}
          </div>
        </div>

        <div className="card">
          <div className="cardInner stack">
            <h2 className="cardTitle">Resume Builder</h2>
            <p className="cardDesc">Upload a CV, paste a job description, and request variants.</p>
            <div className="row">
              <a className="button buttonPrimary" href="/resume">
                Open Resume Builder
              </a>
              <a className="button" href="/dashboard#resume">
                View history
              </a>
            </div>
          </div>
        </div>
      </div>

      <p className="help">
        Note: In this MVP, “Generate” endpoints create DB records (queued/status). Hooking LLM execution comes next.
      </p>
    </div>
  );
}
