'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { NewPracticeButton } from '@/components/NewPracticeButton';
import { BANK_QUESTION_TYPES, type BankQuestion, type SharedQuestion } from '@/lib/questionBank';
import styles from './QuestionBank.module.css';

type CompanyEntry = { company: string; mine: number; shared: number };
type Bank = { company: string; mine: BankQuestion[]; shared: SharedQuestion[] };

/**
 * Company question banks: find a company, see the questions asked there (yours
 * and ones other candidates shared), add one you were asked, and practise
 * with them.
 */
export function QuestionBank({ initialCompany = '' }: { initialCompany?: string }) {
  const t = useTranslations('QuestionBank');
  const [query, setQuery] = useState(initialCompany);
  const [companies, setCompanies] = useState<CompanyEntry[]>([]);
  const [bank, setBank] = useState<Bank | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchId = useId();

  const search = query.trim();
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const res = await fetch(`/api/question-bank${search ? `?q=${encodeURIComponent(search)}` : ''}`).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { companies?: CompanyEntry[] } | null;
      if (!cancelled && res?.ok) setCompanies(json?.companies ?? []);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const open = useCallback(
    async (company: string) => {
      const name = company.trim();
      if (!name) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/question-bank?company=${encodeURIComponent(name)}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error();
        setBank({ company: name, mine: json.mine ?? [], shared: json.shared ?? [] });
      } catch {
        setError(t('loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    // A link from practice setup opens that company straight away.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialCompany) void open(initialCompany);
  }, [initialCompany, open]);

  const exact = companies.some((entry) => entry.company.trim().toLowerCase() === search.toLowerCase());

  return (
    <div className={styles.layout}>
      <section className="card" aria-labelledby={`${searchId}-title`}>
        <div className="cardInner stack">
          <div>
            <h2 className="cardTitle" id={`${searchId}-title`}>
              {t('findTitle')}
            </h2>
            <p className="cardDesc">{t('findDesc')}</p>
          </div>
          <form
            className={styles.searchRow}
            onSubmit={(event) => {
              event.preventDefault();
              void open(search);
            }}
          >
            <label className="srOnly" htmlFor={searchId}>
              {t('company')}
            </label>
            <input
              id={searchId}
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('companyPlaceholder')}
              maxLength={120}
            />
            <button type="submit" className="button buttonPrimary" disabled={!search || loading}>
              {t('open')}
            </button>
          </form>
          {companies.length ? (
            <ul className={styles.companies} aria-label={t('companies')}>
              {companies.map((entry) => (
                <li key={entry.company}>
                  <button
                    type="button"
                    className={styles.company}
                    aria-current={bank?.company.toLowerCase() === entry.company.trim().toLowerCase() ? 'true' : undefined}
                    onClick={() => {
                      setQuery(entry.company);
                      void open(entry.company);
                    }}
                  >
                    <span>{entry.company}</span>
                    <span className={styles.companyCount}>{t('companyCount', { count: entry.mine + entry.shared })}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : search && !exact ? (
            <p className="help">{t('noCompanies')}</p>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      {bank ? <CompanyBank key={bank.company.toLowerCase()} bank={bank} onChange={setBank} /> : null}
    </div>
  );
}

function CompanyBank({ bank, onChange }: { bank: Bank; onChange: (bank: Bank) => void }) {
  const t = useTranslations('QuestionBank');
  const format = useFormatter();
  const [error, setError] = useState<string | null>(null);
  const total = bank.mine.length + bank.shared.length;
  const query = `company=${encodeURIComponent(bank.company)}&bank=1`;

  async function toggleShare(question: BankQuestion) {
    setError(null);
    const res = await fetch(`/api/question-bank/${question.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shared: !question.shared }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!res?.ok || !json?.question) {
      setError(t('saveFailed'));
      return;
    }
    onChange({ ...bank, mine: bank.mine.map((q) => (q.id === question.id ? json.question : q)) });
  }

  async function remove(question: BankQuestion) {
    setError(null);
    const res = await fetch(`/api/question-bank/${question.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setError(t('saveFailed'));
      return;
    }
    onChange({ ...bank, mine: bank.mine.filter((q) => q.id !== question.id) });
  }

  return (
    <section className="card" aria-labelledby="bank-company">
      <div className="cardInner stack">
        <div className={styles.bankHeader}>
          <div>
            <h2 className="cardTitle" id="bank-company">
              {bank.company}
            </h2>
            <p className="cardDesc">{t('bankCount', { count: total })}</p>
          </div>
          {total > 0 ? <NewPracticeButton primary label={t('practice')} query={query} /> : null}
        </div>

        <ReportForm company={bank.company} onAdded={(question) => onChange({ ...bank, mine: [question, ...bank.mine] })} />

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.group}>
          <h3 className={styles.groupTitle}>{t('mine')}</h3>
          {bank.mine.length ? (
            <ul className={styles.questions}>
              {bank.mine.map((question) => (
                <li key={question.id} className={styles.question}>
                  <p className={styles.questionText}>{question.question_text}</p>
                  <div className={styles.questionMeta}>
                    <span className="badge">{t(`types.${question.question_type}`)}</span>
                    <span>{question.source === 'reported' ? t('sourceReported') : t('sourcePractice')}</span>
                    {question.role ? <span>{question.role}</span> : null}
                    <span className={styles.questionActions}>
                      <button type="button" className="button buttonGhost" aria-pressed={question.shared} onClick={() => void toggleShare(question)}>
                        {question.shared ? t('shared') : t('share')}
                      </button>
                      <button type="button" className="button buttonGhost" onClick={() => void remove(question)}>
                        {t('remove')}
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="help">{t('mineEmpty')}</p>
          )}
        </div>

        <div className={styles.group}>
          <h3 className={styles.groupTitle}>{t('others')}</h3>
          {bank.shared.length ? (
            <ul className={styles.questions}>
              {bank.shared.map((question) => (
                <li key={question.question_text} className={styles.question}>
                  <p className={styles.questionText}>{question.question_text}</p>
                  <div className={styles.questionMeta}>
                    <span className="badge">{t(`types.${question.question_type}`)}</span>
                    <span>{t('reports', { count: question.reports })}</span>
                    <span>{format.dateTime(new Date(question.last_reported_at), { dateStyle: 'medium' })}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="help">{t('othersEmpty')}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ReportForm({ company, onAdded }: { company: string; onAdded: (question: BankQuestion) => void }) {
  const t = useTranslations('QuestionBank');
  const [question, setQuestion] = useState('');
  const [type, setType] = useState<(typeof BANK_QUESTION_TYPES)[number]>('general');
  const [role, setRole] = useState('');
  const [share, setShare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { question: useId(), type: useId(), role: useId() };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/question-bank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ company, role: role.trim() || undefined, question, type, shared: share }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error === 'duplicate' ? t('duplicate') : json?.error === 'rate_limited' ? t('rateLimited') : t('saveFailed'));
      onAdded(json.question);
      setQuestion('');
      setRole('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className={styles.report}>
      <summary>{t('addTitle')}</summary>
      <form className="stack" onSubmit={save}>
        <label className="label" htmlFor={ids.question}>
          {t('question')}
          <textarea
            id={ids.question}
            className="textarea"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('questionPlaceholder')}
            minLength={8}
            maxLength={500}
            required
          />
        </label>
        <div className={styles.twoCol}>
          <label className="label" htmlFor={ids.type}>
            {t('type')}
            <select id={ids.type} className="select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {BANK_QUESTION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`types.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="label" htmlFor={ids.role}>
            {t('role')}
            <input id={ids.role} className="input" value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} />
          </label>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>{t('shareHelp')}</span>
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.formActions}>
          <button type="submit" className="button buttonPrimary" disabled={saving || question.trim().length < 8}>
            {saving ? t('saving') : t('add')}
          </button>
        </div>
      </form>
    </details>
  );
}
