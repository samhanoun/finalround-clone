'use client';

import { Link } from '@/i18n/routing';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon } from '@/components/icons';
import { Segmented } from '@/components/practice/Controls';
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
  const listId = useId();
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
      <section className={styles.letters} aria-labelledby={listId}>
        <h2 className={styles.lettersTitle} id={listId}>
          {t('yours')}
          <span className={styles.count}>{letters.length}</span>
        </h2>
        {letters.length === 0 ? (
          <p className={`emptyState ${styles.empty}`}>{t('none')}</p>
        ) : (
          <ul className={styles.list}>
            {letters.map((letter) => (
              <li key={letter.id}>
                <button type="button" className={styles.listItem} onClick={() => setOpenId(letter.id)}>
                  <span className={styles.listText}>
                    <span className={styles.listTitle}>{letterTitle(t, letter)}</span>
                    <span className={styles.listMeta}>
                      {format.dateTime(new Date(letter.updated_at || letter.created_at), { dateStyle: 'medium' })}
                    </span>
                  </span>
                  <ChevronRightIcon size={16} className={styles.listChevron} />
                </button>
              </li>
            ))}
          </ul>
        )}
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
  const ids = { title: useId(), company: useId(), job: useId(), resume: useId(), resumeHelp: useId(), extra: useId(), heading: useId() };

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
    <form className={styles.form} onSubmit={write} aria-labelledby={ids.heading}>
      <div className={styles.formHead}>
        <h2 className={styles.formTitle} id={ids.heading}>
          {t('writeTitle')}
        </h2>
        <p className={styles.formDesc}>{t('writeDesc')}</p>
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
        <select
          id={ids.resume}
          className="select"
          value={resumeId}
          onChange={(e) => setResumeId(e.target.value)}
          required
          disabled={noResumes}
          aria-describedby={noResumes ? ids.resumeHelp : undefined}
        >
          {noResumes ? <option value="">{t('uploadFirst')}</option> : null}
          {props.resumes.map((resume) => (
            <option key={resume.id} value={resume.id}>
              {resume.filename ?? t('resume')}
            </option>
          ))}
        </select>
        {noResumes ? (
          <span id={ids.resumeHelp} className="help">
            {t.rich('uploadHelp', { link: (chunks) => <Link href="/resume">{chunks}</Link> })}
          </span>
        ) : null}
      </label>
      <Segmented
        label={t('tone')}
        options={TONES.map((value) => ({ value, label: t(`tones.${value}`) }))}
        value={tone}
        onChange={setTone}
      />
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
  const headingId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const meta = letter.metadata ?? {};
  const dirty = content !== (letter.content ?? '');
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  // The page grows with the letter, so it reads as a page rather than a box that scrolls.
  useLayoutEffect(() => {
    const field = textRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [content]);

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
        <button type="button" className={`button buttonGhost ${styles.back}`} onClick={props.onClose}>
          <ChevronLeftIcon size={16} />
          {t('allLetters')}
        </button>
        <div className={styles.editorActions}>
          <span className={styles.notice} role="status">
            {dirty ? t('unsaved') : notice}
          </span>
          <button type="button" className="button buttonGhost" onClick={copy}>
            <CopyIcon size={16} />
            {t('copy')}
          </button>
          <a className="button buttonGhost" href={`/api/cover-letters/${letter.id}/export?format=txt`}>
            <DownloadIcon size={16} />
            {t('download')}
          </a>
          <button type="button" className="button buttonPrimary" onClick={save} disabled={!dirty || busy !== null}>
            {busy === 'save' ? t('saving') : t('save')}
          </button>
        </div>
      </div>

      <article className={styles.paper} aria-labelledby={headingId}>
        <header className={styles.paperHead}>
          <h2 className={styles.paperTitle} id={headingId}>
            {letterTitle(t, letter)}
          </h2>
          {typeof meta.alignmentScore === 'number' || meta.matchedKeywords?.length ? (
            <div className={styles.paperMeta}>
              {typeof meta.alignmentScore === 'number' ? (
                <span className={styles.fit} title={t('fitHelp')}>
                  {t('fit', { score: meta.alignmentScore })}
                </span>
              ) : null}
              {meta.matchedKeywords?.length ? (
                <ul className={styles.keywords} aria-label={t('keywords')}>
                  {meta.matchedKeywords.map((keyword) => (
                    <li key={keyword} className={styles.keyword}>
                      {keyword}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </header>
        <label className="srOnly" htmlFor={editorId}>
          {t('letterText')}
        </label>
        <textarea
          ref={textRef}
          id={editorId}
          className={styles.letter}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setNotice(null);
          }}
          rows={16}
          spellCheck
        />
        <footer className={styles.paperFoot}>
          <span className={styles.words}>{t('words', { count: words })}</span>
          {confirmDelete ? (
            <span className={styles.confirm}>
              {t('confirmDelete')}
              <button type="button" className="button buttonDanger buttonSmall" onClick={remove} disabled={busy !== null}>
                {busy === 'delete' ? t('deleting') : t('delete')}
              </button>
              <button type="button" className="button buttonGhost buttonSmall" onClick={() => setConfirmDelete(false)}>
                {t('keep')}
              </button>
            </span>
          ) : (
            <button type="button" className="button buttonGhost buttonSmall" onClick={() => setConfirmDelete(true)}>
              {t('deleteLetter')}
            </button>
          )}
        </footer>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </article>
    </div>
  );
}
