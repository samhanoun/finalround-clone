'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
import { NewPracticeButton } from '@/components/NewPracticeButton';
import { ChevronDownIcon, MicIcon, StopIcon, TargetIcon } from '@/components/icons';
import type { AnswerFeedback, StoredPracticeSetup } from '@/lib/practice/practice';
import { InterviewerAvatar } from './InterviewerAvatar';
import { Segmented, Switch } from './Controls';
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

const TYPES = ['behavioral', 'technical', 'situational', 'mixed'] as const;

/** Setup filled in from elsewhere: the question bank (company), or a goal (everything it knows). */
export type PracticePrefill = {
  company?: string;
  fromBank?: boolean;
  goalName?: string;
  role?: string;
  type?: (typeof TYPES)[number];
  resumeDocumentId?: string;
  jobDescription?: string;
};

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

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

const isFollowUp = (question: PracticeQuestion) => Boolean(question.rubric?.follow_up_of);

/**
 * Main questions are numbered 1…n, as many as the setup asked for; a follow-up
 * carries the number of the question it follows.
 */
function numbering(questions: PracticeQuestion[]) {
  const numbers: number[] = [];
  let n = 0;
  for (const question of questions) {
    if (!isFollowUp(question)) n += 1;
    numbers.push(Math.max(n, 1));
  }
  return { numbers, total: Math.max(n, 1) };
}

/** The report lists next steps in priority order; the model's "P1:" markers repeat that order. */
const withoutPriority = (step: string) => step.replace(/^P\d+\s*[:.)-]\s*/i, '');

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

/** Line icons for the interviewer's voice controls, drawn like the shared set. */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </svg>
  );
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

function SetupForm(props: {
  sessionId: string;
  resumes: ResumeOption[];
  prefill?: PracticePrefill;
  onStarted: (questions: PracticeQuestion[], setup: StoredPracticeSetup) => void;
}) {
  const t = useTranslations('Practice');
  const locale = useLocale();
  const router = useRouter();
  const [role, setRole] = useState(props.prefill?.role ?? '');
  const [company, setCompany] = useState(props.prefill?.company ?? '');
  const [type, setType] = useState<(typeof TYPES)[number]>(props.prefill?.type ?? 'behavioral');
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>('medium');
  const [count, setCount] = useState<(typeof LENGTHS)[number]>(5);
  const [resumeId, setResumeId] = useState(props.prefill?.resumeDocumentId ?? '');
  const [job, setJob] = useState(props.prefill?.jobDescription ?? '');
  const [useBank, setUseBank] = useState(props.prefill?.fromBank ?? true);
  const [followUps, setFollowUps] = useState(true);
  const [bank, setBank] = useState<{ company: string; count: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { role: useId(), company: useId(), resume: useId(), resumeHelp: useId(), job: useId(), error: useId() };

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
    <form className={styles.setup} onSubmit={start} aria-describedby={error ? ids.error : undefined}>
      <div className={styles.setupHead}>
        <h2 className={styles.setupTitle}>{t('setup.title')}</h2>
        <p className={styles.setupDesc}>{t.rich('setup.desc', { bank: (chunks) => <Link href="/interview/bank">{chunks}</Link> })}</p>
        {props.prefill?.goalName ? (
          <p className={styles.goalNote}>
            <TargetIcon size={16} />
            <span>{t('setup.fromGoal', { name: props.prefill.goalName })}</span>
          </p>
        ) : null}
      </div>

      <div className={styles.setupGroup}>
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
              autoComplete="organization-title"
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
              autoComplete="organization"
            />
          </label>
        </div>

        {bankCount > 0 ? (
          <Switch
            label={t('setup.fromBank', { company: companyName })}
            description={t('setup.fromBankHelp', { count: bankCount })}
            checked={useBank}
            onChange={setUseBank}
          />
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

        <Switch label={t('setup.followUps')} description={t('setup.followUpsHelp')} checked={followUps} onChange={setFollowUps} />
      </div>

      <div className={styles.setupGroup}>
        <label className="label" htmlFor={ids.resume}>
          {t('setup.resume')}
          <select
            id={ids.resume}
            className="select"
            value={resumeId}
            onChange={(e) => setResumeId(e.target.value)}
            aria-describedby={ids.resumeHelp}
          >
            <option value="">{t('setup.none')}</option>
            {props.resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.filename ?? t('setup.resumeFallback')}
              </option>
            ))}
          </select>
          <span id={ids.resumeHelp} className="help">
            {t('setup.resumeHelp')}
          </span>
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
      </div>

      {error ? (
        <p id={ids.error} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.startBar}>
        <p className={styles.startSummary}>
          {t('setup.summary', { count, type: t(`types.${type}`), difficulty: t(`difficulties.${difficulty}`) })}
        </p>
        <button type="submit" className="button buttonPrimary" disabled={starting || !role.trim()}>
          {starting ? t('setup.starting') : t('setup.start')}
        </button>
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
  const { numbers, total } = useMemo(() => numbering(questions), [questions]);
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
  // A follow-up shows the exchange it digs into above it.
  const parent = isFollowUp(question) ? (questions.find((q) => q.id === question.rubric?.follow_up_of) ?? null) : null;

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
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const avatarState = voice.speaking ? 'speaking' : listening ? 'listening' : 'idle';
  // One primary at a time: the follow-up or the next question, unless the report is the next step.
  const nextPrimary = Boolean(next) && !(allAnswered && !nextIsFollowUp);
  const nextButton = next ? (
    <button type="button" className={nextPrimary ? 'button buttonPrimary' : 'button'} onClick={() => goTo(index + 1)}>
      {nextIsFollowUp ? t('interview.answerFollowUp') : t('interview.next')}
    </button>
  ) : null;
  const finishButton =
    !next || allAnswered ? (
      <button type="button" className={nextPrimary ? 'button' : 'button buttonPrimary'} onClick={finish} disabled={finishing || !allAnswered}>
        {finishing ? t('interview.finishing') : t('interview.finish')}
      </button>
    ) : null;

  return (
    <div className={styles.interview}>
      <nav className={styles.progress} aria-label={t('interview.questions')}>
        <p className={styles.progressLabel}>{t('interview.progress', { current: numbers[index], total })}</p>
        <ol className={styles.steps}>
          {questions.map((q, i) => {
            const done = q.rubric?.feedback;
            const followUp = isFollowUp(q);
            return (
              <li key={q.id} className={styles.stepItem} data-kind={followUp ? 'follow-up' : 'main'}>
                <button
                  type="button"
                  className={styles.step}
                  data-state={i === index ? 'current' : done ? 'done' : 'open'}
                  aria-current={i === index ? 'step' : undefined}
                  aria-label={t(followUp ? 'interview.stepFollowUp' : 'interview.step', {
                    n: numbers[i],
                    answered: done ? 'yes' : 'no',
                  })}
                  disabled={!done && i !== firstOpen && i !== index}
                  onClick={() => goTo(i)}
                >
                  <span className={styles.stepName}>{followUp ? t('interview.followUp') : t('interview.railQuestion', { n: numbers[i] })}</span>
                  {done ? <span className={styles.stepScore}>{t('interview.stepScore', { score: done.score })}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={styles.main}>
        <div className={styles.thread}>
          {parent ? (
            <div className={styles.context}>
              <div className={`${styles.turn} ${styles.them}`}>
                <div className={styles.gutter}>
                  <span className={styles.mark} aria-hidden="true" />
                </div>
                <div className={styles.body}>
                  <p className={styles.contextSpeaker}>{t('interview.interviewer')}</p>
                  <p className={styles.contextText}>{parent.question_text}</p>
                </div>
              </div>
              {parent.response_text ? (
                <div className={`${styles.turn} ${styles.you}`}>
                  <div className={styles.gutter}>
                    <span className={styles.mark} aria-hidden="true" />
                  </div>
                  <div className={styles.body}>
                    <p className={styles.contextSpeaker}>{t('interview.yourAnswer')}</p>
                    <p className={styles.contextText}>{parent.response_text}</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <section className={`${styles.turn} ${styles.them} ${styles.asking}`} aria-label={t('interview.question')}>
            <div className={styles.gutter}>
              <InterviewerAvatar state={avatarState} label={t(`interview.avatar.${avatarState}`)} />
            </div>
            <div className={styles.body}>
              <div className={styles.speaker}>
                <span className={styles.speakerName}>{t('interview.interviewer')}</span>
                {isFollowUp(question) ? <span className={styles.speakerTag}>{t('interview.followUp')}</span> : null}
                <span className={styles.questionMeta}>
                  <span>{label(t, 'questionTypes', question.question_type)}</span>
                  <span>{label(t, 'difficulties', question.difficulty)}</span>
                </span>
                {voice.supported ? (
                  <span className={styles.voiceControls}>
                    <button
                      type="button"
                      className={`button buttonGhost buttonSmall ${styles.voiceButton}`}
                      onClick={() => (voice.speaking ? stopVoice() : speak(question.question_text))}
                      disabled={voice.muted}
                      aria-label={voice.speaking ? t('interview.stopSpeaking') : t('interview.repeat')}
                    >
                      {voice.speaking ? <StopIcon size={16} /> : <ReplayIcon />}
                      <span className={styles.voiceText}>{voice.speaking ? t('interview.stopSpeaking') : t('interview.repeat')}</span>
                    </button>
                    <button
                      type="button"
                      className={`button buttonGhost buttonSmall ${styles.voiceButton}`}
                      aria-pressed={voice.muted}
                      onClick={() => voice.setMuted(!voice.muted)}
                      aria-label={voice.muted ? t('interview.unmute') : t('interview.mute')}
                    >
                      <SpeakerIcon muted={voice.muted} />
                      <span className={styles.voiceText}>{voice.muted ? t('interview.unmute') : t('interview.mute')}</span>
                    </button>
                  </span>
                ) : null}
              </div>
              <p className={styles.questionText}>{question.question_text}</p>
            </div>
          </section>

          {editing ? (
            <div className={`${styles.turn} ${styles.you}`}>
              <div className={styles.gutter}>
                <span className={styles.mark} aria-hidden="true" />
              </div>
              <div className={styles.body}>
                <div className={styles.answerHead}>
                  <label className={styles.youLabel} htmlFor={answerId}>
                    {t('interview.yourAnswer')}
                  </label>
                  <span className={styles.answerMeta}>
                    <span>{t('interview.words', { count: words })}</span>
                    <span>
                      <span className="srOnly">{t('interview.time')} </span>
                      {clock}
                    </span>
                  </span>
                </div>
                <textarea
                  id={answerId}
                  className={`textarea ${styles.answer}`}
                  rows={7}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('interview.placeholder')}
                  maxLength={8_000}
                />
                {canDictate ? <p className={styles.help}>{t('interview.dictationHelp')}</p> : null}
              </div>
            </div>
          ) : feedback ? (
            <>
              <div className={`${styles.turn} ${styles.you}`}>
                <div className={styles.gutter}>
                  <span className={styles.mark} aria-hidden="true" />
                </div>
                <div className={styles.body}>
                  <p className={styles.youLabel}>{t('interview.yourAnswer')}</p>
                  <p className={styles.answerText}>{question.response_text}</p>
                </div>
              </div>
              <FeedbackPanel feedback={feedback} />
            </>
          ) : null}
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {!editing && feedback && nextIsFollowUp && !next?.rubric?.feedback ? (
          <p className={styles.followUpNote} role="status">
            <span className={styles.followUpDot} aria-hidden="true" />
            {t('interview.followUpComing')}
          </p>
        ) : null}

        <div className={styles.actionBar}>
          {editing ? (
            <>
              {isFollowUp(question) ? (
                <button type="button" className="button buttonGhost" onClick={skipFollowUp} disabled={submitting || finishing}>
                  {t('interview.skipFollowUp')}
                </button>
              ) : null}
              <span className={styles.actionSpacer} />
              {canDictate ? (
                <button
                  type="button"
                  className={`button ${styles.dictate}`}
                  onClick={toggleDictation}
                  aria-pressed={listening}
                  aria-label={listening ? t('interview.stopDictating') : t('interview.dictate')}
                >
                  {listening ? <StopIcon size={16} /> : <MicIcon size={16} />}
                  <span className={styles.dictateText}>{listening ? t('interview.stopDictating') : t('interview.dictate')}</span>
                </button>
              ) : null}
              <button type="button" className="button buttonPrimary" onClick={submit} disabled={submitting || !draft.trim()}>
                {submitting ? t('interview.scoring') : t('interview.submit')}
              </button>
            </>
          ) : feedback ? (
            <>
              <button type="button" className="button buttonGhost" onClick={() => setEditing(true)}>
                {t('interview.answerAgain')}
              </button>
              <span className={styles.actionSpacer} />
              {/* The primary goes last, nearest the thumb. */}
              {nextPrimary ? (
                <>
                  {finishButton}
                  {nextButton}
                </>
              ) : (
                <>
                  {nextButton}
                  {finishButton}
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The coach's read of one answer: the score, then what worked, what to change and what a stronger answer covers. */
function FeedbackPanel({ feedback }: { feedback: AnswerFeedback }) {
  const t = useTranslations('Practice');
  const sections = [
    ['worked', feedback.strengths],
    ['improve', feedback.improvements],
    ['stronger', feedback.stronger_answer],
  ] as const;
  return (
    <section className={styles.feedback} aria-label={t('feedback.label')}>
      <div className={styles.verdictRow}>
        <p className={styles.score}>
          <span className={styles.scoreValue}>{feedback.score}</span>
          <span className={styles.scoreOf}>{t('feedback.outOf')}</span>
        </p>
        <p className={styles.verdict}>{feedback.verdict}</p>
      </div>
      <div className={styles.sections}>
        {sections.map(([key, items]) =>
          items.length ? (
            <section key={key} className={styles.section}>
              <h3 className={styles.sectionTitle}>{t(`feedback.${key}`)}</h3>
              <ul className={styles.points}>
                {items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null,
        )}
      </div>
    </section>
  );
}

/** The hiring signal's dot: green for a hire, red for a no hire, neutral in between. */
const SIGNAL_TONE: Record<string, 'good' | 'fair' | 'low'> = {
  strong_hire: 'good',
  hire: 'good',
  lean_hire: 'fair',
  lean_no_hire: 'fair',
  no_hire: 'low',
  strong_no_hire: 'low',
};

function ReportView(props: { sessionId: string; report: PracticeReport; questions: PracticeQuestion[] }) {
  const t = useTranslations('Practice');
  const { report } = props;
  const overall = Math.max(0, Math.min(100, report.overall_score ?? 0));
  const signal = report.hiring_signal ? label(t, 'signals', report.hiring_signal) : null;
  // Skipped follow-ups weren't part of the interview.
  const asked = props.questions.filter((q) => !(isFollowUp(q) && !q.rubric?.feedback));
  const { numbers } = numbering(asked);
  const lists = [
    { key: 'strengths', title: t('report.strengths'), items: report.strengths ?? [] },
    { key: 'toWorkOn', title: t('report.toWorkOn'), items: report.weaknesses ?? [] },
  ].filter((list) => list.items.length);
  const nextSteps = (report.next_steps ?? []).map(withoutPriority).filter(Boolean);
  const dimensions = DIMENSIONS.flatMap((key) => (report.rubric?.[key] ? [{ key, ...report.rubric[key] }] : []));

  return (
    <div className={styles.report}>
      <section className={styles.hero} aria-label={t('report.overall')}>
        <div className={styles.overall}>
          <p className={styles.overallLabel}>{t('report.overall')}</p>
          <p className={styles.overallFigure}>
            <span className={styles.overallNumber}>{overall}</span>
            <span className={styles.overallOf}>{t('report.outOf')}</span>
          </p>
          <span className={styles.overallBar} aria-hidden="true">
            <span style={{ transform: `scaleX(${overall / 100})` }} />
          </span>
        </div>
        <div className={styles.heroText}>
          {signal ? (
            <p className={styles.signal} data-tone={SIGNAL_TONE[report.hiring_signal ?? ''] ?? 'fair'}>
              <span className={styles.signalDot} aria-hidden="true" />
              {signal}
            </p>
          ) : null}
          {report.summary ? <p className={styles.summary}>{report.summary}</p> : null}
        </div>
      </section>

      <div className={styles.reportGrid}>
        {dimensions.length ? (
          <section className={styles.reportSection} aria-label={t('report.byAreaLabel')}>
            <h2 className={styles.reportHeading}>{t('report.byArea')}</h2>
            <ul className={styles.rubric}>
              {dimensions.map((dimension) => (
                <li key={dimension.key} className={styles.area}>
                  <div className={styles.areaHead}>
                    <span className={styles.areaName}>{t(`dimensions.${dimension.key}`)}</span>
                    <span className={styles.areaBar} aria-hidden="true">
                      <span style={{ transform: `scaleX(${Math.max(0, Math.min(5, dimension.score)) / 5})` }} />
                    </span>
                    <span className={styles.areaScore}>{t('report.outOfFive', { score: dimension.score })}</span>
                  </div>
                  {dimension.evidence || dimension.recommendation ? (
                    <dl className={styles.areaNotes}>
                      {dimension.evidence ? (
                        <>
                          <dt>{t('report.evidence')}</dt>
                          <dd>{dimension.evidence}</dd>
                        </>
                      ) : null}
                      {dimension.recommendation ? (
                        <>
                          <dt>{t('report.change')}</dt>
                          <dd>{dimension.recommendation}</dd>
                        </>
                      ) : null}
                    </dl>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {lists.length || nextSteps.length ? (
          <div className={styles.reportLists}>
            {lists.map((list) => (
              <section key={list.key} className={styles.reportSection} aria-label={list.title}>
                <h2 className={styles.reportHeading}>{list.title}</h2>
                <ul className={styles.points}>
                  {list.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
            {nextSteps.length ? (
              <section className={styles.reportSection} aria-label={t('report.nextSteps')}>
                <h2 className={styles.reportHeading}>{t('report.nextSteps')}</h2>
                <ol className={styles.steplist}>
                  {nextSteps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className={styles.reportSection} aria-label={t('report.eachAnswer')}>
        <h2 className={styles.reportHeading}>{t('report.eachAnswer')}</h2>
        <ol className={styles.answers}>
          {asked.map((q, i) => {
            const fb = q.rubric?.feedback;
            const followUp = isFollowUp(q);
            return (
              <li key={q.id} className={styles.answerItem} data-kind={followUp ? 'follow-up' : 'main'}>
                <details>
                  <summary className={styles.answerSummary}>
                    <span className={styles.answerIndex}>{followUp ? null : numbers[i]}</span>
                    <span className={styles.answerQuestion}>
                      {followUp ? <span className={styles.followUpTag}>{t('interview.followUp')}</span> : null}
                      {q.question_text}
                    </span>
                    {fb ? <span className={styles.answerScore}>{t('interview.stepScore', { score: fb.score })}</span> : null}
                    <ChevronDownIcon size={16} className={styles.chevron} />
                  </summary>
                  <div className={styles.answerDetail}>
                    {q.response_text ? (
                      <div className={`${styles.turn} ${styles.you}`}>
                        <div className={styles.gutter}>
                          <span className={styles.mark} aria-hidden="true" />
                        </div>
                        <div className={styles.body}>
                          <p className={styles.youLabel}>{t('feedback.yourAnswer')}</p>
                          <p className={styles.answerText}>{q.response_text}</p>
                        </div>
                      </div>
                    ) : null}
                    {fb ? <FeedbackPanel feedback={fb} /> : <p className={styles.help}>{t('report.notAnswered')}</p>}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </section>

      <div className={styles.reportActions}>
        <a className="button" href={`/api/interviews/${props.sessionId}/export`}>
          {t('report.export')}
        </a>
        <NewPracticeButton primary label={t('report.again')} />
      </div>
    </div>
  );
}
