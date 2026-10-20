'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

export type InterviewContext = {
  resumeDocumentId: string;
  company: string;
  role: string;
  jobDescription: string;
};

export const EMPTY_INTERVIEW_CONTEXT: InterviewContext = { resumeDocumentId: '', company: '', role: '', jobDescription: '' };

type ResumeOption = { id: string; filename: string | null; created_at: string };

/** Only filled fields go to the start route. */
export function interviewContextBody(context: InterviewContext) {
  const trimmed = {
    resumeDocumentId: context.resumeDocumentId || undefined,
    company: context.company.trim() || undefined,
    role: context.role.trim() || undefined,
    jobDescription: context.jobDescription.trim() || undefined,
  };
  return Object.fromEntries(Object.entries(trimmed).filter(([, value]) => value !== undefined));
}

/**
 * Optional interview context for a session: which résumé to draw facts from,
 * and the job. The server turns it into the session's context pack.
 */
export function InterviewContextFields({
  value,
  onChange,
  disabled,
}: {
  value: InterviewContext;
  onChange: (next: InterviewContext) => void;
  disabled: boolean;
}) {
  const [resumes, setResumes] = useState<ResumeOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from('resume_documents')
      .select('id, filename, created_at')
      .not('parsed_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!cancelled) setResumes((data as ResumeOption[] | null) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<InterviewContext>) => onChange({ ...value, ...patch });
  const filled = Boolean(value.resumeDocumentId || value.company || value.role || value.jobDescription);

  return (
    <details className="stack" style={{ gap: 10 }} open={filled || undefined}>
      <summary className="small" style={{ cursor: 'pointer' }}>
        <strong>Interview context</strong> (optional): lets answers use your real experience and the job&apos;s requirements
      </summary>

      <div className="grid2">
        <label className="label">
          Résumé
          <select
            className="select"
            value={value.resumeDocumentId}
            onChange={(e) => set({ resumeDocumentId: e.target.value })}
            disabled={disabled || resumes === null}
          >
            <option value="">{resumes === null ? 'Loading…' : 'None'}</option>
            {(resumes ?? []).map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.filename ?? 'Untitled'} · {new Date(resume.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <label className="label">
          Company
          <input
            className="input"
            value={value.company}
            onChange={(e) => set({ company: e.target.value })}
            placeholder="e.g. Acme"
            maxLength={200}
            disabled={disabled}
          />
        </label>
      </div>

      {resumes !== null && resumes.length === 0 ? (
        <p className="small" style={{ margin: 0 }}>
          No parsed résumés yet. Upload one on the Résumé page to use it here.
        </p>
      ) : null}

      <label className="label">
        Role
        <input
          className="input"
          value={value.role}
          onChange={(e) => set({ role: e.target.value })}
          placeholder="e.g. Senior Software Engineer"
          maxLength={200}
          disabled={disabled}
        />
      </label>

      <label className="label">
        Job description
        <textarea
          className="textarea"
          rows={5}
          value={value.jobDescription}
          onChange={(e) => set({ jobDescription: e.target.value })}
          placeholder="Paste the job posting. Requirements and responsibilities matter most."
          maxLength={20_000}
          disabled={disabled}
        />
      </label>
    </details>
  );
}
