'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/routing';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { NewPracticeButton } from '@/components/NewPracticeButton';
import type { AnswerFeedback, StoredPracticeSetup } from '@/lib/practice/practice';
import { InterviewerAvatar } from './InterviewerAvatar';
import { useInterviewerVoice } from './useInterviewerVoice';
import styles from './PracticeInterview.module.css';

export type PracticeQuestion = {
  id: string;
  question_text: string;
  question_type: string;
  difficulty: string;
  order_index: number;
  response_text: string | null;
  response_score: number | null;
  /** `follow_up_of`: this is the interviewer's follow-up to that question; `follow_up_id`: this question's follow-up. */
  rubric: { feedback?: AnswerFeedback; follow_up_of?: string; follow_up_id?: string } | null;
  answered_at: string | null;
};

type Dimension = { score: number; evidence: string; recommendation: string };

export type PracticeReport = {
  overall_score: number | null;
  hiring_signal: string | null;
  summary: string | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  next_steps: string[] | null;
  rubric: Partial<Record<'clarity' | 'confidence' | 'relevance' | 'structure', Dimension>> | null;
};

export type ResumeOption = { id: string; filename: string | null };

/** Setup fields filled in from a link, e.g. "Practice these" in the question bank. */
export type PracticePrefill = { company?: string; fromBank?: boolean };

const TYPES = ['behavioral', 'technical', 'situational', 'mixed'] as const;
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const LENGTHS = [3, 5, 8] as const;
const DIMENSIONS = ['relevance', 'structure', 'clarity', 'confidence'] as const;

type T = ReturnType<typeof useTranslations>;

function errorText(t: T, code: unknown, fallback: string) {
  return typeof code === 'string' && t.has(`errors.${code}`) ? t(`errors.${code}`) : fallback;
}

/** A stored value shown through the message files when they know it, as it is otherwise. */
function label(t: T, group: string, value: string) {
  return t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value;
}

function scoreTone(score10: number) {
  return score10 >= 8 ? 'good' : score10 >= 5 ? 'fair' : 'low';
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

const isFollowUp = (question: PracticeQuestion) => Boolean(question.rubric?.follow_up_of);

/** Browser speech recognition, where the browser has it (Chrome, Edge, Safari). */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function speechRecognition(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function PracticeInterview(props: {
  sessionId: string;
  setup: StoredPracticeSetup | null;
  questions: PracticeQuestion[];
  report: PracticeReport | null;
  resumes: ResumeOption[];
  prefill?: PracticePrefill;
}) {
  const [questions, setQuestions] = useState(props.questions);
  const [setup, setSetup] = useState(props.setup);
  const [report, setReport] = useState(props.report);

  if (questions.length === 0) {
    return (
      <SetupForm
        sessionId={props.sessionId}
        resumes={props.resumes}
        prefill={props.prefill}
        onStarted={(next, nextSetup) => {
          setQuestions(next);
          setSetup(nextSetup);
        }}
      />
    );
  }
  if (report) return <ReportView sessionId={props.sessionId} report={report} questions={questions} />;
  return (
    <InterviewView
      sessionId={props.sessionId}
      setup={setup}
      questions={questions}
      onAnswered={(question, followUp) =>
        setQuestions((list) => {
          const next = list.map((q) => (q.id === question.id ? question : q));
          // The follow-up comes right after the answer it digs into.
          if (followUp && !next.some((q) => q.id === followUp.id)) {
            next.splice(next.findIndex((q) => q.id === question.id) + 1, 0, followUp);
          }
          return next;
        })
      }
      onReport={setReport}
    />
  );
}

function Segmented<V extends string | number>(props: {
  label: string;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <div className={styles.field}>
      <span className="label">{props.label}</span>
      <div className={styles.segmented} role="radiogroup" aria-label={props.label}>
        {props.options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={option.value === props.value}
            className={styles.segment}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SetupForm(props: {
  sessionId: string;
  resumes: ResumeOption[];
  prefill?: PracticePrefill;
  onStarted: (questions: PracticeQuestion[], setup: StoredPracticeSetup) => void;
}) {
  const t = useTranslations('Practice');
  const locale = useLocale();
  const router = useRouter();
  const [role, setRole] = useState('');
  const [company, setCompany] = useState(props.prefill?.company ?? '');
  const [type, setType] = useState<(typeof TYPES)[number]>('behavioral');
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>('medium');
  const [count, setCount] = useState<(typeof LENGTHS)[number]>(5);
  const [resumeId, setResumeId] = useState('');
  const [job, setJob] = useState('');
  const [useBank, setUseBank] = useState(props.prefill?.fromBank ?? true);
  const [followUps, setFollowUps] = useState(true);
  const [bank, setBank] = useState<{ company: string; count: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { role: useId(), company: useId(), resume: useId(), job: useId(), error: useId() };

  // How many questions the company's bank has, once the name has settled.
  const companyName = company.trim();
  useEffect(() => {
    if (!companyName) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/question-bank?company=${encodeURIComponent(companyName)}`);
        const json = (await res.json().catch(() => ({}))) as { mine?: unknown[]; shared?: unknown[] };
        if (!cancelled && res.ok) setBank({ company: companyName, count: (json.mine?.length ?? 0) + (json.shared?.length ?? 0) });
      } catch {
        // No bank count; the interview still starts without it.
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [companyName]);
  const bankCount = bank && companyName && bank.company === companyName ? bank.count : 0;

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setStarting(true);
    const failed = t('setup.startFailed');
    try {
      const res = await fetch(`/api/interviews/${props.sessionId}/practice/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role,
          company: company || undefined,
          type,
          difficulty,
          count,
          resumeDocumentId: resumeId || undefined,
          jobDescription: job.trim() || undefined,
          fromBank: bankCount > 0 && useBank ? true : undefined,
          locale,
          followUps,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(t, json?.error, failed));
      props.onStarted(json.questions, json.setup);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : failed);
    } finally {
      setStarting(false);
    }
  }

  return (
    <form className={`card ${styles.setup}`} onSubmit={start} aria-describedby={error ? ids.error : undefined}>
      <div className="cardInner stack">
        <div>
          <h2 className="cardTitle">{t('setup.title')}</h2>
          <p className="cardDesc">
            {t.rich('setup.desc', { bank: (chunks) => <Link href="/interview/bank">{chunks}</Link> })}
          </p>
        </div>

        <div className={styles.twoCol}>
          <label className="label" htmlFor={ids.role}>
            {t('setup.role')}
            <input
              id={ids.role}
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={t('setup.rolePlaceholder')}
              required
              maxLength={120}
            />
          </label>
          <label className="label" htmlFor={ids.company}>
            {t('setup.company')}
            <input
              id={ids.company}
              className="input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t('setup.companyPlaceholder')}
              maxLength={120}
            />
          </label>
        </div>

        {bankCount > 0 ? (
          <label className={styles.check}>
            <input type="checkbox" checked={useBank} onChange={(e) => setUseBank(e.target.checked)} />
            <span>
              <strong>{t('setup.fromBank', { company: companyName, count: bankCount })}</strong> {t('setup.fromBankHelp')}
            </span>
          </label>
        ) : null}

        <Segmented
          label={t('setup.type')}
          options={TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
          value={type}
          onChange={setType}
        />
        <div className={styles.twoCol}>
          <Segmented
            label={t('setup.difficulty')}
            options={DIFFICULTIES.map((value) => ({ value, label: t(`difficulties.${value}`) }))}
            value={difficulty}
            onChange={setDifficulty}
          />
          <Segmented
            label={t('setup.length')}
            options={LENGTHS.map((n) => ({ value: n, label: t('setup.lengthOption', { count: n }) }))}
            value={count}
            onChange={setCount}
          />
        </div>

        <label className={styles.check}>
          <input type="checkbox" checked={followUps} onChange={(e) => setFollowUps(e.target.checked)} />
          <span>
            <strong>{t('setup.followUps')}</strong> {t('setup.followUpsHelp')}
          </span>
        </label>

        <label className="label" htmlFor={ids.resume}>
          {t('setup.resume')}
          <select id={ids.resume} className="select" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">{t('setup.none')}</option>
            {props.resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.filename ?? t('setup.resumeFallback')}
              </option>
            ))}
          </select>
          <span className="help">{t('setup.resumeHelp')}</span>
        </label>

        <label className="label" htmlFor={ids.job}>
          {t('setup.job')}
          <textarea
            id={ids.job}
            className="textarea"
            rows={4}
            value={job}
            onChange={(e) => setJob(e.target.value)}
            placeholder={t('setup.jobPlaceholder')}
            maxLength={20_000}
          />
        </label>

        {error ? (
          <p id={ids.error} className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          <button type="submit" className="button buttonPrimary" disabled={starting || !role.trim()}>
            {starting ? t('setup.starting') : t('setup.start')}
          </button>
        </div>
      </div>
    </form>
  );
}

function InterviewView(props: {
  sessionId: string;
  setup: StoredPracticeSetup | null;
  questions: PracticeQuestion[];
  onAnswered: (question: PracticeQuestion, followUp: PracticeQuestion | null) => void;
  onReport: (report: PracticeReport) => void;
}) {
  const t = useTranslations('Practice');
  const locale = useLocale();
  const { questions } = props;
  const router = useRouter();
  // The first question still to answer; a follow-up that was skipped (a later answer exists) doesn't count.
  const firstOpen = questions.findIndex(
    (q, i) => !q.rubric?.feedback && !(isFollowUp(q) && questions.slice(i + 1).some((later) => later.rubric?.feedback)),
  );
  const [index, setIndex] = useState(firstOpen === -1 ? questions.length - 1 : firstOpen);
  const question = questions[index];
  const feedback = question.rubric?.feedback ?? null;
  const next = questions[index + 1] ?? null;
  const nextIsFollowUp = next?.rubric?.follow_up_of === question.id;
  // Follow-ups are optional: the interview is done once every main question has feedback.
  const allAnswered = questions.every((q) => q.rubric?.feedback || isFollowUp(q));

  const [draft, setDraft] = useState(question.response_text ?? '');
  const [editing, setEditing] = useState(!feedback);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seconds spent on the current question.
  const [seconds, setSeconds] = useState(0);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const answerId = useId();
  const canDictate = useMemo(() => speechRecognition() !== null, []);
  const voice = useInterviewerVoice(locale);
  const { speak, stop: stopVoice } = voice;

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  // The interviewer asks each question aloud when it comes up.
  const questionText = question.question_text;
  useEffect(() => {
    if (editing) speak(questionText);
  }, [editing, questionText, speak]);

  function goTo(target: number) {
    recognitionRef.current?.stop();
    stopVoice();
    const nextQuestion = questions[target];
    setIndex(target);
    setDraft(nextQuestion.response_text ?? '');
    setEditing(!nextQuestion.rubric?.feedback);
    setError(null);
    setSeconds(0);
  }

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Speech = speechRecognition();
    if (!Speech) return;
    // The microphone would hear the interviewer.
    stopVoice();
    const recognition = new Speech();
    recognition.lang = document.documentElement.lang || locale;
    recognition.continuous = true;
    recognition.interimResults = false;
    const base = draft.trim();
    let heard = '';
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) heard += `${event.results[i][0].transcript.trim()} `;
      }
      setDraft([base, heard.trim()].filter(Boolean).join(' '));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function submit() {
    recognitionRef.current?.stop();
    stopVoice();
    setError(null);
    setSubmitting(true);
    const failed = t('interview.scoreFailed');
    try {
      const res = await fetch(`/api/interviews/${props.sessionId}/practice/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, answer: draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(t, json?.error, failed));
      const followUp = (json.followUp ?? null) as PracticeQuestion | null;
      props.onAnswered(
        {
          ...question,
          response_text: draft,
          response_score: json.feedback.score * 10,
          rubric: { ...question.rubric, feedback: json.feedback, ...(followUp ? { follow_up_id: followUp.id } : {}) },
          answered_at: json.answeredAt,
        },
        followUp,
      );
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : failed);
    } finally {
      setSubmitting(false);
    }
  }

  async function finish() {
    stopVoice();
    setError(null);
    setFinishing(true);
    const failed = t('errors.report_generation_failed');
    try {
      const mode = props.setup?.type === 'mixed' ? 'general' : (props.setup?.type ?? 'general');
      const res = await fetch(`/api/interviews/${props.sessionId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(t, json?.error, failed));
      props.onReport(json.report);
      // The header shows the interview's status, which is now "Completed".
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : failed);
    } finally {
      setFinishing(false);
    }
  }

  function skipFollowUp() {
    if (next) goTo(index + 1);
    else if (allAnswered) void finish();
  }

  const words = wordCount(draft);
  const avatarState = voice.speaking ? 'speaking' : listening ? 'listening' : 'idle';
  const finishButton = (
    <button type="button" className="button buttonPrimary" onClick={finish} disabled={finishing || !allAnswered}>
      {finishing ? t('interview.finishing') : t('interview.finish')}
    </button>
  );

  return (
    <div className={styles.interview}>
      <nav className={styles.progress} aria-label={t('interview.questions')}>
        <span className={styles.progressLabel}>{t('interview.progress', { current: index + 1, total: questions.length })}</span>
        <ol className={styles.steps}>
          {questions.map((q, i) => (
            <li key={q.id}>
              <button
                type="button"
                className={styles.step}
                data-state={i === index ? 'current' : q.rubric?.feedback ? 'done' : 'open'}
                data-kind={isFollowUp(q) ? 'follow-up' : undefined}
                aria-current={i === index ? 'step' : undefined}
                aria-label={t(isFollowUp(q) ? 'interview.stepFollowUp' : 'interview.step', {
                  n: i + 1,
                  answered: q.rubric?.feedback ? 'yes' : 'no',
                })}
                disabled={!q.rubric?.feedback && i !== firstOpen && i !== index}
                onClick={() => goTo(i)}
              />
            </li>
          ))}
        </ol>
      </nav>

      <section className={styles.questionCard} aria-label={t('interview.question')}>
        <div className={styles.questionRow}>
          <InterviewerAvatar state={avatarState} label={t(`interview.avatar.${avatarState}`)} />
          <div className={styles.questionBody}>
            <div className={styles.questionMeta}>
              <span className={styles.who}>{t('interview.interviewer')}</span>
              {isFollowUp(question) ? <span className="badge badgePro">{t('interview.followUp')}</span> : null}
              <span className="badge">{label(t, 'questionTypes', question.question_type)}</span>
              <span className="badge">{label(t, 'difficulties', question.difficulty)}</span>
            </div>
            <p className={styles.questionText}>{question.question_text}</p>
            {voice.supported ? (
              <div className={styles.voiceControls}>
                <button
                  type="button"
                  className="button buttonGhost"
                  onClick={() => (voice.speaking ? stopVoice() : speak(question.question_text))}
                  disabled={voice.muted}
                >
                  {voice.speaking ? t('interview.stopSpeaking') : t('interview.repeat')}
                </button>
                <button type="button" className="button buttonGhost" aria-pressed={voice.muted} onClick={() => voice.setMuted(!voice.muted)}>
                  {voice.muted ? t('interview.unmute') : t('interview.mute')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {editing ? (
        <section className="card">
          <div className="cardInner stack">
            <label className="label" htmlFor={answerId}>
              <span className={styles.youLabel}>{t('interview.yourAnswer')}</span>
              <textarea
                id={answerId}
                className={`textarea ${styles.answer}`}
                rows={8}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('interview.placeholder')}
                maxLength={8_000}
              />
            </label>
            <div className={styles.answerBar}>
              <span className={styles.meta}>
                <span>{t('interview.words', { count: words })}</span>
                <span aria-label={t('interview.time')}>
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                </span>
              </span>
              <div className={styles.answerButtons}>
                {isFollowUp(question) ? (
                  <button type="button" className="button buttonGhost" onClick={skipFollowUp} disabled={submitting || finishing}>
                    {t('interview.skipFollowUp')}
                  </button>
                ) : null}
                {canDictate ? (
                  <button type="button" className="button" onClick={toggleDictation} aria-pressed={listening}>
                    {listening ? t('interview.stopDictating') : t('interview.dictate')}
                  </button>
                ) : null}
                <button type="button" className="button buttonPrimary" onClick={submit} disabled={submitting || !draft.trim()}>
                  {submitting ? t('interview.scoring') : t('interview.submit')}
                </button>
              </div>
            </div>
            {canDictate ? <p className="help">{t('interview.dictationHelp')}</p> : null}
          </div>
        </section>
      ) : feedback ? (
        <FeedbackPanel answer={question.response_text ?? ''} feedback={feedback} />
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {!editing && feedback ? (
        <>
          {nextIsFollowUp && !next?.rubric?.feedback ? (
            <p className={styles.followUpNote} role="status">
              {t('interview.followUpComing')}
            </p>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className="button buttonGhost" onClick={() => setEditing(true)}>
              {t('interview.answerAgain')}
            </button>
            {next ? (
              <button type="button" className={`button ${allAnswered && !nextIsFollowUp ? '' : 'buttonPrimary'}`} onClick={() => goTo(index + 1)}>
                {nextIsFollowUp ? t('interview.answerFollowUp') : t('interview.next')}
              </button>
            ) : null}
            {!next || allAnswered ? finishButton : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function FeedbackPanel({ answer, feedback }: { answer: string; feedback: AnswerFeedback }) {
  const t = useTranslations('Practice');
  return (
    <section className={`card ${styles.feedback}`} aria-label={t('feedback.label')}>
      <div className="cardInner stack">
        <div className={styles.scoreRow}>
          <span className={styles.score} data-tone={scoreTone(feedback.score)}>
            {feedback.score}
            <span className={styles.scoreOf}>/10</span>
          </span>
          <p className={styles.verdict}>{feedback.verdict}</p>
        </div>
        <div className={styles.columns}>
          {feedback.strengths.length ? (
            <div>
              <h3 className={styles.listTitle}>{t('feedback.worked')}</h3>
              <ul className={styles.points} data-tone="good">
                {feedback.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {feedback.improvements.length ? (
            <div>
              <h3 className={styles.listTitle}>{t('feedback.improve')}</h3>
              <ul className={styles.points} data-tone="ember">
                {feedback.improvements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        {feedback.stronger_answer.length ? (
          <div>
            <h3 className={styles.listTitle}>{t('feedback.stronger')}</h3>
            <ul className={styles.points} data-tone="ice">
              {feedback.stronger_answer.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <details className={styles.yourAnswer}>
          <summary>{t('feedback.yourAnswer')}</summary>
          <p>{answer}</p>
        </details>
      </div>
    </section>
  );
}

function ReportView(props: { sessionId: string; report: PracticeReport; questions: PracticeQuestion[] }) {
  const t = useTranslations('Practice');
  const { report } = props;
  const overall = report.overall_score ?? 0;
  const signal = report.hiring_signal ? label(t, 'signals', report.hiring_signal) : null;
  const tone = overall >= 75 ? 'good' : overall >= 50 ? 'fair' : 'low';
  // Skipped follow-ups weren't part of the interview.
  const asked = props.questions.filter((q) => !(isFollowUp(q) && !q.rubric?.feedback));

  return (
    <div className={styles.report}>
      <section className={`card ${styles.reportHero}`} aria-label={t('report.overall')}>
        <div className="cardInner">
          <div className={styles.heroRow}>
            <div className={styles.overall} data-tone={tone}>
              <span className={styles.overallNumber}>{overall}</span>
              <span className={styles.overallOf}>{t('report.outOf')}</span>
            </div>
            <div className={styles.heroText}>
              {signal ? <span className={`badge ${tone === 'good' ? 'badgeLive' : tone === 'fair' ? 'badgePro' : 'badgeAlert'}`}>{signal}</span> : null}
              {report.summary ? <p className={styles.summary}>{report.summary}</p> : null}
            </div>
          </div>
        </div>
      </section>

      {report.rubric ? (
        <section className="card" aria-label={t('report.byAreaLabel')}>
          <div className="cardInner stack">
            <h2 className="cardTitle">{t('report.byArea')}</h2>
            <ul className={styles.dimensions}>
              {DIMENSIONS.map((key) => {
                const dimension = report.rubric?.[key];
                if (!dimension) return null;
                return (
                  <li key={key} className={styles.dimension}>
                    <div className={styles.dimensionHead}>
                      <span>{t(`dimensions.${key}`)}</span>
                      <span className={styles.meta}>{t('report.outOfFive', { score: dimension.score })}</span>
                    </div>
                    <div className={styles.bar} aria-hidden="true">
                      <span style={{ width: `${(dimension.score / 5) * 100}%` }} />
                    </div>
                    {dimension.recommendation ? <p className={styles.dimensionTip}>{dimension.recommendation}</p> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}

      <div className={styles.reportLists}>
        <ReportList title={t('report.strengths')} items={report.strengths} tone="good" />
        <ReportList title={t('report.toWorkOn')} items={report.weaknesses} tone="ember" />
        <ReportList title={t('report.nextSteps')} items={report.next_steps} tone="ice" ordered />
      </div>

      <section className="card" aria-label={t('report.eachAnswer')}>
        <div className="cardInner stack">
          <h2 className="cardTitle">{t('report.eachAnswer')}</h2>
          <ol className={styles.breakdown}>
            {asked.map((q, i) => {
              const fb = q.rubric?.feedback;
              return (
                <li key={q.id}>
                  <details>
                    <summary className={styles.breakdownSummary}>
                      <span className={styles.breakdownIndex}>{i + 1}</span>
                      <span className={styles.breakdownQuestion}>
                        {isFollowUp(q) ? <span className={styles.followUpTag}>{t('interview.followUp')}</span> : null}
                        {q.question_text}
                      </span>
                      {fb ? (
                        <span className={styles.breakdownScore} data-tone={scoreTone(fb.score)}>
                          {fb.score}/10
                        </span>
                      ) : null}
                    </summary>
                    {fb ? <FeedbackPanel answer={q.response_text ?? ''} feedback={fb} /> : <p className="help">{t('report.notAnswered')}</p>}
                  </details>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <div className={styles.actions}>
        <a className="button" href={`/api/interviews/${props.sessionId}/export`}>
          {t('report.export')}
        </a>
        <NewPracticeButton primary label={t('report.again')} />
      </div>
    </div>
  );
}

function ReportList(props: { title: string; items: string[] | null; tone: 'good' | 'ember' | 'ice'; ordered?: boolean }) {
  if (!props.items?.length) return null;
  const List = props.ordered ? 'ol' : 'ul';
  return (
    <section className="card" aria-label={props.title}>
      <div className="cardInner stack">
        <h2 className="cardTitle">{props.title}</h2>
        <List className={styles.points} data-tone={props.tone}>
          {props.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </List>
      </div>
    </section>
  );
}
