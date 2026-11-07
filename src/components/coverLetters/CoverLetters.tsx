'use client';

import { Link } from '@/i18n/routing';
import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
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

const TONES = ['professional', 'friendly', 'confident', 'formal'] as const;

type T = ReturnType<typeof useTranslations>;

function errorText(t: T, code: unknown, fallback: string) {
  return typeof code === 'string' && t.has(`errors.${code}`) ? t(`errors.${code}`) : fallback;
}

function letterTitle(t: T, letter: CoverLetter) {
  const meta = letter.metadata ?? {};
  if (meta.jobTitle && meta.companyName) return t('titleAt', { role: meta.jobTitle, company: meta.companyName });
  return letter.title ?? t('fallbackTitle');
}

export function CoverLetters(props: { initialLetters: CoverLetter[]; resumes: ResumeOption[] }) {
  const t = useTranslations('CoverLetters');
  const format = useFormatter();
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
      <section className="card" aria-label={t('yours')}>
        <div className="cardInner stack">
          <h2 className="cardTitle">{t('yours')}</h2>
          {letters.length === 0 ? (
            <p className="help">{t('none')}</p>
          ) : (
            <ul className={styles.list}>
              {letters.map((letter) => (
                <li key={letter.id}>
                  <button type="button" className={styles.listItem} onClick={() => setOpenId(letter.id)}>
                    <span className={styles.listTitle}>{letterTitle(t, letter)}</span>
                    <span className={styles.listMeta}>
                      {format.dateTime(new Date(letter.updated_at || letter.created_at), { dateStyle: 'medium' })}
                    </span>
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
  const t = useTranslations('CoverLetters');
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [job, setJob] = useState('');
  const [resumeId, setResumeId] = useState(props.resumes[0]?.id ?? '');
  const [tone, setTone] = useState<(typeof TONES)[number]>('professional');
  const [extra, setExtra] = useState('');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { title: useId(), company: useId(), job: useId(), resume: useId(), extra: useId() };

  async function write(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setWriting(true);
    const failed = t('writeFailed');
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
      if (!res.ok) throw new Error(errorText(t, json?.error, failed));
      props.onWritten(json.cover_letter as CoverLetter);
    } catch (e) {
      setError(e instanceof Error ? e.message : failed);
    } finally {
      setWriting(false);
    }
  }

  const noResumes = props.resumes.length === 0;

  return (
    <form className="card" onSubmit={write}>
      <div className="cardInner stack">
        <div>
          <h2 className="cardTitle">{t('writeTitle')}</h2>
          <p className="cardDesc">{t('writeDesc')}</p>
        </div>
        <div className={styles.twoCol}>
          <label className="label" htmlFor={ids.title}>
            {t('role')}
            <input
              id={ids.title}
              className="input"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              required
              maxLength={150}
              placeholder={t('rolePlaceholder')}
            />
          </label>
          <label className="label" htmlFor={ids.company}>
            {t('company')}
            <input
              id={ids.company}
              className="input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
              maxLength={150}
              placeholder={t('companyPlaceholder')}
            />
          </label>
        </div>
        <label className="label" htmlFor={ids.job}>
          {t('job')}
          <textarea
            id={ids.job}
            className="textarea"
            rows={6}
            value={job}
            onChange={(e) => setJob(e.target.value)}
            required
            minLength={50}
            maxLength={20_000}
            placeholder={t('jobPlaceholder')}
          />
        </label>
        <label className="label" htmlFor={ids.resume}>
          {t('resume')}
          <select id={ids.resume} className="select" value={resumeId} onChange={(e) => setResumeId(e.target.value)} required disabled={noResumes}>
            {noResumes ? <option value="">{t('uploadFirst')}</option> : null}
            {props.resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.filename ?? t('resume')}
              </option>
            ))}
          </select>
          {noResumes ? (
            <span className="help">{t.rich('uploadHelp', { link: (chunks) => <Link href="/resume">{chunks}</Link> })}</span>
          ) : null}
        </label>
        <div className={styles.field}>
          <span className="label">{t('tone')}</span>
          <div className={styles.segmented} role="radiogroup" aria-label={t('tone')}>
            {TONES.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={tone === value}
                className={styles.segment}
                onClick={() => setTone(value)}
              >
                {t(`tones.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="label" htmlFor={ids.extra}>
          {t('extra')}
          <input
            id={ids.extra}
            className="input"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            maxLength={500}
            placeholder={t('extraPlaceholder')}
          />
        </label>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="submit" className="button buttonPrimary" disabled={writing || noResumes || !jobTitle.trim() || !company.trim() || job.trim().length < 50}>
            {writing ? t('writing') : t('write')}
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
  const t = useTranslations('CoverLetters');
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
      setNotice(t('saved'));
    } catch {
      setError(t('saveFailed'));
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
      setError(t('deleteFailed'));
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setNotice(t('copied'));
    } catch {
      setError(t('copyFailed'));
    }
  }

  return (
    <div className={styles.editor}>
      <div className={styles.editorBar}>
        <button type="button" className="button buttonGhost" onClick={props.onClose}>
          {t('allLetters')}
        </button>
        <div className={styles.editorActions}>
          {notice ? (
            <span className={styles.notice} role="status">
              {notice}
            </span>
          ) : null}
          <button type="button" className="button" onClick={copy}>
            {t('copy')}
          </button>
          <a className="button" href={`/api/cover-letters/${letter.id}/export?format=txt`}>
            {t('download')}
          </a>
          <button type="button" className="button buttonPrimary" onClick={save} disabled={!dirty || busy !== null}>
            {busy === 'save' ? t('saving') : t('save')}
          </button>
        </div>
      </div>

      <section className={`card ${styles.paper}`} aria-label={t('fallbackTitle')}>
        <div className="cardInner stack">
          <div className={styles.paperHead}>
            <h2 className="cardTitle">{letterTitle(t, letter)}</h2>
            {typeof meta.alignmentScore === 'number' ? (
              <span className="badge badgeIce" title={t('fitHelp')}>
                {t('fit', { score: meta.alignmentScore })}
              </span>
            ) : null}
          </div>
          {meta.matchedKeywords?.length ? (
            <div className={styles.keywords} aria-label={t('keywords')}>
              {meta.matchedKeywords.map((keyword) => (
                <span key={keyword} className={styles.keyword}>
                  {keyword}
                </span>
              ))}
            </div>
          ) : null}
          <label className="srOnly" htmlFor={editorId}>
            {t('letterText')}
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
            <span className={styles.listMeta}>{t('words', { count: words })}</span>
            {confirmDelete ? (
              <span className={styles.confirm}>
                {t('confirmDelete')}
                <button type="button" className="button buttonDanger" onClick={remove} disabled={busy !== null}>
                  {busy === 'delete' ? t('deleting') : t('delete')}
                </button>
                <button type="button" className="button buttonGhost" onClick={() => setConfirmDelete(false)}>
                  {t('keep')}
                </button>
              </span>
            ) : (
              <button type="button" className="button buttonGhost" onClick={() => setConfirmDelete(true)}>
                {t('deleteLetter')}
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
