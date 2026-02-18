'use client';

import { useRouter } from 'next/navigation';
import { useState, useId } from 'react';
import { useToastHook } from '@/components/Toast';
import { Link } from '@/i18n/routing';

export function DashboardClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const toast = useToastHook();

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
      
      toast.success('Interview Created', 'Your new interview session is ready!');
      router.push(`/interview/${json.session.id}`);
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      toast.error('Error', message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <div className="grid2">
        <div className="card" role="region" aria-labelledby="interview-heading">
          <div className="cardInner stack">
            <h2 className="cardTitle" id="interview-heading">Interview Copilot</h2>
            <p className="cardDesc">Create an interview session, chat, and capture feedback + score.</p>
            <div className="row">
              <button 
                className="button buttonPrimary" 
                onClick={createInterview} 
                disabled={loading} 
                type="button"
                aria-describedby={loading ? 'creating-status' : undefined}
              >
                {loading ? 'Creating…' : 'New session'}
              </button>
              <Link className="button" href="/dashboard" scroll={false} aria-label="View your interview sessions">
                View sessions
              </Link>
            </div>
            {error && (
              <div 
                className="error" 
                role="alert"
                id={errorId}
                aria-live="assertive"
              >
                {error}
              </div>
            )}
            {loading && (
              <span id="creating-status" className="srOnly">
                Creating new interview session, please wait...
              </span>
            )}
          </div>
        </div>

        <div className="card" role="region" aria-labelledby="resume-heading">
          <div className="cardInner stack">
            <h2 className="cardTitle" id="resume-heading">Resume Builder</h2>
            <p className="cardDesc">Upload a CV, paste a job description, and request variants.</p>
            <div className="row">
              <Link 
                className="button buttonPrimary" 
                href="/resume"
                aria-label="Open Resume Builder"
              >
                Open Resume Builder
              </Link>
              <Link className="button" href="/dashboard" scroll={false} aria-label="View your resume history">
                View history
              </Link>
            </div>
          </div>
        </div>
      </div>

      <p className="help" role="note">
        Note: In this MVP, &quot;Generate&quot; endpoints create DB records (queued/status). Hooking LLM execution comes next.
      </p>
    </div>
  );
}
