'use client';

import { useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/browser';
import styles from './SessionSetup.module.css';

export type CopilotMode = 'general' | 'coding' | 'phone' | 'video';

export type SessionSetupValue = {
  mode: CopilotMode;
  title: string;
  company: string;
  role: string;
  resumeDocumentId: string;
  jobDescription: string;
  /** Coding sessions: hints and approach only, no complete solutions. */
  noFullCode: boolean;
};

export const EMPTY_SETUP: SessionSetupValue = {
  mode: 'general',
  title: '',
  company: '',
  role: '',
  resumeDocumentId: '',
  jobDescription: '',
  noFullCode: false,
};

const STORAGE_KEY = 'apex.sessionSetup.v1';
const MODES: CopilotMode[] = ['general', 'coding', 'phone', 'video'];

type ResumeOption = { id: string; filename: string | null; created_at: string };

/** The last setup this browser used, so a second interview for the same job starts fast. */
export function loadSavedSetup(): SessionSetupValue {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SETUP;
    const saved = JSON.parse(raw) as Partial<SessionSetupValue>;
    const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
    return {
      mode: MODES.includes(saved.mode as CopilotMode) ? (saved.mode as CopilotMode) : 'general',
      title: text(saved.title, 200),
      company: text(saved.company, 200),
      role: text(saved.role, 200),
      resumeDocumentId: text(saved.resumeDocumentId, 64),
      jobDescription: text(saved.jobDescription, 20_000),
      noFullCode: saved.noFullCode === true,
    };
  } catch {
    return EMPTY_SETUP;
  }
}

export function saveSetup(value: SessionSetupValue): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode): nothing to remember
  }
}

/** The start route's body: only filled fields, with a sensible default title. */
export function setupStartBody(value: SessionSetupValue) {
  const company = value.company.trim();
  const role = value.role.trim();
  const target = [role, company && `at ${company}`].filter(Boolean).join(' ');
  const optional = {
    resumeDocumentId: value.resumeDocumentId || undefined,
    company: company || undefined,
    role: role || undefined,
    jobDescription: value.jobDescription.trim() || undefined,
  };
  return {
    title: value.title.trim() || target || `Live ${value.mode} session`,
    metadata: {
      mode: value.mode,
      beta: true,
      noFullCodeMode: value.mode === 'coding' && value.noFullCode,
    },
    ...Object.fromEntries(Object.entries(optional).filter(([, field]) => field !== undefined)),
  };
}

/**
 * The pre-session setup step: the interview, the résumé to draw facts from,
 * and the job. All optional; the server turns it into the context pack.
 */
export function SessionSetup({
  value,
  onChange,
  onStart,
  starting,
}: {
  value: SessionSetupValue;
  onChange: (next: SessionSetupValue) => void;
  onStart: () => void;
  starting: boolean;
}) {
  const [resumes, setResumes] = useState<ResumeOption[] | null>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from('resume_documents')
      .select('id, filename, created_at')
      .not('parsed_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (cancelled) return;
        const list = (data as ResumeOption[] | null) ?? [];
        setResumes(list);
        // A remembered résumé that has since been deleted shouldn't be sent.
        const { value: current, onChange: update } = latest.current;
        if (current.resumeDocumentId && !list.some((resume) => resume.id === current.resumeDocumentId)) {
          update({ ...current, resumeDocumentId: '' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<SessionSetupValue>) => onChange({ ...value, ...patch });
  const titlePlaceholder =
    [value.role.trim(), value.company.trim() && `at ${value.company.trim()}`].filter(Boolean).join(' ') ||
    'e.g. Senior SWE at Acme';

  return (
    <section className="card" aria-label="Session setup">
      <div className="cardInner stack" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 className="cardTitle">Set up your interview</h2>
          <p className="small" style={{ margin: 0 }}>
            Everything here is optional. The more context you give, the more answers sound like you: they only use facts
            from your résumé.
          </p>
        </div>

        <ol className={styles.steps}>
          <li className={styles.step}>
            <h3 className={styles.stepTitle}>The interview</h3>
            <div className="grid2">
              <label className="label">
                Interview type
                <select
                  className="select"
                  value={value.mode}
                  onChange={(e) => set({ mode: e.target.value as CopilotMode })}
                  disabled={starting}
                >
                  <option value="general">General interview</option>
                  <option value="coding">Coding interview</option>
                  <option value="phone">Phone screen</option>
                  <option value="video">Video call</option>
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
                  disabled={starting}
                />
              </label>
              <label className="label">
                Role
                <input
                  className="input"
                  value={value.role}
                  onChange={(e) => set({ role: e.target.value })}
                  placeholder="e.g. Senior Software Engineer"
                  maxLength={200}
                  disabled={starting}
                />
              </label>
              <label className="label">
                Session title
                <input
                  className="input"
                  value={value.title}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder={titlePlaceholder}
                  maxLength={200}
                  disabled={starting}
                />
              </label>
            </div>
            {value.mode === 'coding' ? (
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={value.noFullCode}
                  onChange={(e) => set({ noFullCode: e.target.checked })}
                  disabled={starting}
                />
                <span>
                  <strong>Hints only.</strong> Show the approach, complexity and hints, but never a complete solution.
                </span>
              </label>
            ) : null}
          </li>

          <li className={styles.step}>
            <h3 className={styles.stepTitle}>Your résumé</h3>
            <label className="label">
              Résumé
              <select
                className="select"
                value={value.resumeDocumentId}
                onChange={(e) => set({ resumeDocumentId: e.target.value })}
                disabled={starting || resumes === null}
              >
                <option value="">{resumes === null ? 'Loading…' : 'None'}</option>
                {(resumes ?? []).map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.filename ?? 'Untitled'} · {new Date(resume.created_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </label>
            {resumes !== null && resumes.length === 0 ? (
              <p className="small" style={{ margin: 0 }}>
                No parsed résumés yet. <Link href="/resume">Upload one on the Résumé page</Link> to use it here.
              </p>
            ) : null}
          </li>

          <li className={styles.step}>
            <h3 className={styles.stepTitle}>The job</h3>
            <label className="label">
              Job description
              <textarea
                className="textarea"
                rows={5}
                value={value.jobDescription}
                onChange={(e) => set({ jobDescription: e.target.value })}
                placeholder="Paste the job posting. Requirements and responsibilities matter most."
                maxLength={20_000}
                disabled={starting}
              />
            </label>
          </li>
        </ol>

        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="button buttonPrimary"
            type="button"
            onClick={onStart}
            disabled={starting}
          >
            {starting ? 'Starting…' : 'Start session'}
          </button>
          <span className="small">Next: share your meeting tab with audio, then pop out the answer window.</span>
        </div>
      </div>
    </section>
  );
}
