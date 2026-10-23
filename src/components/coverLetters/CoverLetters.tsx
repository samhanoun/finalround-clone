'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import styles from './CoverLetters.module.css';

export type CoverLetter = {
  id: string;
  title: string | null;
  content: string | null;
  tone: string;
  status: string;
  metadata: {
    matchedKeywords?: string[];
    alignmentScore?: number | null;
    jobTitle?: string;
    companyName?: string;
  } | null;
  created_at: string;
  updated_at: string;
};

export type ResumeOption = { id: string; filename: string | null };

const TONES = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Warm' },
  { value: 'confident', label: 'Confident' },
  { value: 'formal', label: 'Formal' },
] as const;

const ERRORS: Record<string, string> = {
  llm_unavailable: 'No AI model is set up for this app yet: it needs an OpenAI or Anthropic API key.',
  resume_not_parsed: "That résumé hasn't been read yet. Pick another.",
  resume_required: 'Pick a résumé so the letter can use your experience.',
  rate_limited: 'Too many requests in a row. Wait a few seconds and try again.',
  invalid_body: 'Check the form: the job description needs at least a few sentences.',
};

function errorText(code: unknown, fallback: string) {
  return (typeof code === 'string' && ERRORS[code]) || fallback;
}

function letterTitle(letter: CoverLetter) {
  const meta = letter.metadata ?? {};
  if (meta.jobTitle && meta.companyName) return `${meta.jobTitle} at ${meta.companyName}`;
  return letter.title ?? 'Cover letter';
}

export function CoverLetters(props: { initialLetters: CoverLetter[]; resumes: ResumeOption[] }) {
  const [letters, setLetters] = useState(props.initialLetters);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = letters.find((letter) => letter.id === openId) ?? null;

  if (open) {
    return (
      <LetterEditor
        letter={open}
        onClose={() => setOpenId(null)}
        onSaved={(updated) => setLetters((list) => list.map((l) => (l.id === updated.id ? updated : l)))}
        onDeleted={(id) => {
          setLetters((list) => list.filter((l) => l.id !== id));
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <div className={styles.layout}>
      <WriteForm
        resumes={props.resumes}
        onWritten={(letter) => {
          setLetters((list) => [letter, ...list]);
          setOpenId(letter.id);
        }}
      />
      <section className="card" aria-label="Your letters">
        <div className="cardInner stack">
          <h2 className="cardTitle">Your letters</h2>
          {letters.length === 0 ? (
            <p className="help">No letters yet. The ones you write are saved here, ready to edit.</p>
          ) : (
            <ul className={styles.list}>
              {letters.map((letter) => (
                <li key={letter.id}>
                  <button type="button" className={styles.listItem} onClick={() => setOpenId(letter.id)}>
                    <span className={styles.listTitle}>{letterTitle(letter)}</span>
                    <span className={styles.listMeta}>{new Date(letter.updated_at || letter.created_at).toLocaleDateString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function WriteForm(props: { resumes: ResumeOption[]; onWritten: (letter: CoverLetter) => void }) {
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [job, setJob] = useState('');
  const [resumeId, setResumeId] = useState(props.resumes[0]?.id ?? '');
  const [tone, setTone] = useState<(typeof TONES)[number]['value']>('professional');
  const [extra, setExtra] = useState('');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { title: useId(), company: useId(), job: useId(), resume: useId(), extra: useId() };

  async function write(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setWriting(true);
    try {
      const res = await fetch('/api/cover-letters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobTitle,
          companyName: company,
          jobDescription: job,
          resumeDocumentId: resumeId || undefined,
          tone,
          additionalContext: extra.trim() || undefined,
          save: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, "The letter wasn't written. Try again."));
      props.onWritten(json.cover_letter as CoverLetter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The letter wasn't written. Try again.");
    } finally {
      setWriting(false);
    }
  }

  const noResumes = props.resumes.length === 0;

  return (
    <form className="card" onSubmit={write}>
      <div className="cardInner stack">
        <div>
          <h2 className="cardTitle">Write a cover letter</h2>
          <p className="cardDesc">Built from your résumé and the job posting. Edit it as much as you like afterwards.</p>
        </div>
        <div className={styles.twoCol}>
          <label className="label" htmlFor={ids.title}>
            Role
            <input id={ids.title} className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} required maxLength={150} placeholder="e.g. Product Designer" />
          </label>
          <label className="label" htmlFor={ids.company}>
            Company
            <input id={ids.company} className="input" value={company} onChange={(e) => setCompany(e.target.value)} required maxLength={150} placeholder="e.g. Acme" />
          </label>
        </div>
        <label className="label" htmlFor={ids.job}>
          Job description
          <textarea
            id={ids.job}
            className="textarea"
            rows={6}
            value={job}
            onChange={(e) => setJob(e.target.value)}
            required
            minLength={50}
            maxLength={20_000}
            placeholder="Paste the posting: responsibilities and requirements matter most."
          />
        </label>
        <label className="label" htmlFor={ids.resume}>
          Résumé
          <select id={ids.resume} className="select" value={resumeId} onChange={(e) => setResumeId(e.target.value)} required disabled={noResumes}>
            {noResumes ? <option value="">Upload a résumé first</option> : null}
            {props.resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.filename ?? 'Résumé'}
              </option>
            ))}
          </select>
          {noResumes ? (
            <span className="help">
              <Link href="/resume">Upload your résumé</Link> and it will appear here.
            </span>
          ) : null}
        </label>
        <div className={styles.field}>
          <span className="label">Tone</span>
          <div className={styles.segmented} role="radiogroup" aria-label="Tone">
            {TONES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={tone === option.value}
                className={styles.segment}
                onClick={() => setTone(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className="label" htmlFor={ids.extra}>
          Anything to mention (optional)
          <input id={ids.extra} className="input" value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={500} placeholder="e.g. I use the product every day; I can relocate in May." />
        </label>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="submit" className="button buttonPrimary" disabled={writing || noResumes || !jobTitle.trim() || !company.trim() || job.trim().length < 50}>
            {writing ? 'Writing your letter…' : 'Write the letter'}
          </button>
        </div>
      </div>
    </form>
  );
}

function LetterEditor(props: {
  letter: CoverLetter;
  onClose: () => void;
  onSaved: (letter: CoverLetter) => void;
  onDeleted: (id: string) => void;
}) {
  const { letter } = props;
  const [content, setContent] = useState(letter.content ?? '');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editorId = useId();
  const meta = letter.metadata ?? {};
  const dirty = content !== (letter.content ?? '');
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  async function save() {
    setBusy('save');
    setError(null);
    try {
      const res = await fetch(`/api/cover-letters/${letter.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, status: 'saved' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error();
      props.onSaved({ ...letter, ...(json.cover_letter ?? {}), content });
      setNotice('Saved');
    } catch {
      setError("Your changes weren't saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);
    try {
      const res = await fetch(`/api/cover-letters/${letter.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      props.onDeleted(letter.id);
    } catch {
      setError("The letter wasn't deleted. Try again.");
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setNotice('Copied');
    } catch {
      setError("Couldn't copy. Select the text and copy it instead.");
    }
  }

  return (
    <div className={styles.editor}>
      <div className={styles.editorBar}>
        <button type="button" className="button buttonGhost" onClick={props.onClose}>
          All letters
        </button>
        <div className={styles.editorActions}>
          {notice ? (
            <span className={styles.notice} role="status">
              {notice}
            </span>
          ) : null}
          <button type="button" className="button" onClick={copy}>
            Copy
          </button>
          <a className="button" href={`/api/cover-letters/${letter.id}/export?format=txt`}>
            Download
          </a>
          <button type="button" className="button buttonPrimary" onClick={save} disabled={!dirty || busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <section className={`card ${styles.paper}`} aria-label="Cover letter">
        <div className="cardInner stack">
          <div className={styles.paperHead}>
            <h2 className="cardTitle">{letterTitle(letter)}</h2>
            {typeof meta.alignmentScore === 'number' ? (
              <span className="badge badgeIce" title="How well your résumé matches the job, as judged by the AI">
                Fit {meta.alignmentScore}/100
              </span>
            ) : null}
          </div>
          {meta.matchedKeywords?.length ? (
            <div className={styles.keywords} aria-label="Job keywords your résumé covers">
              {meta.matchedKeywords.map((keyword) => (
                <span key={keyword} className={styles.keyword}>
                  {keyword}
                </span>
              ))}
            </div>
          ) : null}
          <label className="srOnly" htmlFor={editorId}>
            Letter text
          </label>
          <textarea
            id={editorId}
            className={`textarea ${styles.letter}`}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setNotice(null);
            }}
            rows={20}
          />
          <div className={styles.paperFoot}>
            <span className={styles.listMeta}>
              {words} {words === 1 ? 'word' : 'words'}
            </span>
            {confirmDelete ? (
              <span className={styles.confirm}>
                Delete this letter?
                <button type="button" className="button buttonDanger" onClick={remove} disabled={busy !== null}>
                  {busy === 'delete' ? 'Deleting…' : 'Delete'}
                </button>
                <button type="button" className="button buttonGhost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button type="button" className="button buttonGhost" onClick={() => setConfirmDelete(true)}>
                Delete letter
              </button>
            )}
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
