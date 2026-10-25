'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NewPracticeButton } from '@/components/NewPracticeButton';
import type { AnswerFeedback, StoredPracticeSetup } from '@/lib/practice/practice';
import styles from './PracticeInterview.module.css';

export type PracticeQuestion = {
  id: string;
  question_text: string;
  question_type: string;
  difficulty: string;
  order_index: number;
  response_text: string | null;
  response_score: number | null;
  rubric: { feedback?: AnswerFeedback } | null;
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

const TYPES = [
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'technical', label: 'Technical' },
  { value: 'situational', label: 'Situational' },
  { value: 'mixed', label: 'Mixed' },
] as const;
const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
] as const;
const LENGTHS = [3, 5, 8] as const;

const SIGNALS: Record<string, string> = {
  strong_hire: 'Strong hire',
  hire: 'Hire',
  lean_hire: 'Leaning hire',
  lean_no_hire: 'Leaning no hire',
  no_hire: 'No hire',
  strong_no_hire: 'Strong no hire',
};

const DIMENSIONS = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'structure', label: 'Structure' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'confidence', label: 'Confidence' },
] as const;

const ERRORS: Record<string, string> = {
  llm_unavailable: 'No AI model is set up for this app yet: it needs an OpenAI or Anthropic API key.',
  questions_unavailable: "The questions didn't come through. Try again.",
  feedback_unavailable: "Your answer is saved, but the feedback didn't come through. Submit it again.",
  rate_limited: 'Too many requests in a row. Wait a few seconds and try again.',
  resume_not_parsed: "That résumé hasn't been read yet. Pick another, or none.",
  already_started: 'This interview has already started. Reload the page.',
  report_generation_failed: "The report didn't come through. Try again.",
};

function errorText(code: unknown, fallback: string) {
  return (typeof code === 'string' && ERRORS[code]) || fallback;
}

function scoreTone(score10: number) {
  return score10 >= 8 ? 'good' : score10 >= 5 ? 'fair' : 'low';
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

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
}) {
  const [questions, setQuestions] = useState(props.questions);
  const [setup, setSetup] = useState(props.setup);
  const [report, setReport] = useState(props.report);

  if (questions.length === 0) {
    return (
      <SetupForm
        sessionId={props.sessionId}
        resumes={props.resumes}
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
      onAnswered={(question) => setQuestions((list) => list.map((q) => (q.id === question.id ? question : q)))}
      onReport={setReport}
    />
  );
}

function Segmented<T extends string | number>(props: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
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
  onStarted: (questions: PracticeQuestion[], setup: StoredPracticeSetup) => void;
}) {
  const router = useRouter();
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('behavioral');
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]['value']>('medium');
  const [count, setCount] = useState<(typeof LENGTHS)[number]>(5);
  const [resumeId, setResumeId] = useState('');
  const [job, setJob] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { role: useId(), company: useId(), resume: useId(), job: useId(), error: useId() };

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setStarting(true);
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
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, 'The interview could not start. Try again.'));
      props.onStarted(json.questions, json.setup);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The interview could not start. Try again.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <form className={`card ${styles.setup}`} onSubmit={start} aria-describedby={error ? ids.error : undefined}>
      <div className="cardInner stack">
        <div>
          <h2 className="cardTitle">Set up your practice interview</h2>
          <p className="cardDesc">
            An AI interviewer asks questions for the role, then scores each answer and tells you what to change.
          </p>
        </div>

        <div className={styles.twoCol}>
          <label className="label" htmlFor={ids.role}>
            Role
            <input
              id={ids.role}
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Senior Product Manager"
              required
              maxLength={120}
            />
          </label>
          <label className="label" htmlFor={ids.company}>
            Company (optional)
            <input
              id={ids.company}
              className="input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Acme"
              maxLength={120}
            />
          </label>
        </div>

        <Segmented label="Interview type" options={TYPES} value={type} onChange={setType} />
        <div className={styles.twoCol}>
          <Segmented label="Difficulty" options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
          <Segmented
            label="Length"
            options={LENGTHS.map((n) => ({ value: n, label: `${n} questions` }))}
            value={count}
            onChange={setCount}
          />
        </div>

        <label className="label" htmlFor={ids.resume}>
          Résumé (optional)
          <select id={ids.resume} className="select" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            <option value="">None</option>
            {props.resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.filename ?? 'Résumé'}
              </option>
            ))}
          </select>
          <span className="help">Questions can then refer to your own projects.</span>
        </label>

        <label className="label" htmlFor={ids.job}>
          Job description (optional)
          <textarea
            id={ids.job}
            className="textarea"
            rows={4}
            value={job}
            onChange={(e) => setJob(e.target.value)}
            placeholder="Paste the posting to get questions about what this team needs."
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
            {starting ? 'Writing your questions…' : 'Start the interview'}
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
  onAnswered: (question: PracticeQuestion) => void;
  onReport: (report: PracticeReport) => void;
}) {
  const { questions } = props;
  const router = useRouter();
  const firstOpen = questions.findIndex((q) => !q.rubric?.feedback);
  const [index, setIndex] = useState(firstOpen === -1 ? questions.length - 1 : firstOpen);
  const question = questions[index];
  const feedback = question.rubric?.feedback ?? null;
  const isLast = index === questions.length - 1;
  const allAnswered = questions.every((q) => q.rubric?.feedback);

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

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  function goTo(next: number) {
    recognitionRef.current?.stop();
    const target = questions[next];
    setIndex(next);
    setDraft(target.response_text ?? '');
    setEditing(!target.rubric?.feedback);
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
    const recognition = new Speech();
    recognition.lang = document.documentElement.lang || 'en-US';
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
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/interviews/${props.sessionId}/practice/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, answer: draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, 'Your answer could not be scored. Try again.'));
      props.onAnswered({
        ...question,
        response_text: draft,
        response_score: json.feedback.score * 10,
        rubric: { feedback: json.feedback },
        answered_at: json.answeredAt,
      });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your answer could not be scored. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function finish() {
    setError(null);
    setFinishing(true);
    try {
      const mode = props.setup?.type === 'mixed' ? 'general' : (props.setup?.type ?? 'general');
      const res = await fetch(`/api/interviews/${props.sessionId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, "The report didn't come through. Try again."));
      props.onReport(json.report);
      // The header shows the interview's status, which is now "Completed".
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report didn't come through. Try again.");
    } finally {
      setFinishing(false);
    }
  }

  const words = wordCount(draft);

  return (
    <div className={styles.interview}>
      <nav className={styles.progress} aria-label="Questions">
        <span className={styles.progressLabel}>
          Question {index + 1} of {questions.length}
        </span>
        <ol className={styles.steps}>
          {questions.map((q, i) => (
            <li key={q.id}>
              <button
                type="button"
                className={styles.step}
                data-state={i === index ? 'current' : q.rubric?.feedback ? 'done' : 'open'}
                aria-current={i === index ? 'step' : undefined}
                aria-label={`Question ${i + 1}${q.rubric?.feedback ? ', answered' : ''}`}
                disabled={!q.rubric?.feedback && i !== firstOpen && i !== index}
                onClick={() => goTo(i)}
              />
            </li>
          ))}
        </ol>
      </nav>

      <section className={styles.questionCard} aria-label="Question">
        <div className={styles.questionMeta}>
          <span className={styles.who}>Interviewer</span>
          <span className="badge">{question.question_type}</span>
          <span className="badge">{question.difficulty}</span>
        </div>
        <p className={styles.questionText}>{question.question_text}</p>
      </section>

      {editing ? (
        <section className="card">
          <div className="cardInner stack">
            <label className="label" htmlFor={answerId}>
              <span className={styles.youLabel}>Your answer</span>
              <textarea
                id={answerId}
                className={`textarea ${styles.answer}`}
                rows={8}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Answer as you would out loud: the situation, what you did, and the result."
                maxLength={8_000}
              />
            </label>
            <div className={styles.answerBar}>
              <span className={styles.meta}>
                <span>
                  {words} {words === 1 ? 'word' : 'words'}
                </span>
                <span aria-label="Time on this question">
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                </span>
              </span>
              <div className={styles.answerButtons}>
                {canDictate ? (
                  <button type="button" className="button" onClick={toggleDictation} aria-pressed={listening}>
                    {listening ? 'Stop dictating' : 'Dictate'}
                  </button>
                ) : null}
                <button type="button" className="button buttonPrimary" onClick={submit} disabled={submitting || !draft.trim()}>
                  {submitting ? 'Scoring your answer…' : 'Submit answer'}
                </button>
              </div>
            </div>
            {canDictate ? <p className="help">Dictation uses your browser’s speech recognition.</p> : null}
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
        <div className={styles.actions}>
          <button type="button" className="button buttonGhost" onClick={() => setEditing(true)}>
            Answer again
          </button>
          {isLast || allAnswered ? (
            <button type="button" className="button buttonPrimary" onClick={finish} disabled={finishing || !allAnswered}>
              {finishing ? 'Writing your report…' : 'Finish and see my report'}
            </button>
          ) : (
            <button type="button" className="button buttonPrimary" onClick={() => goTo(index + 1)}>
              Next question
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FeedbackPanel({ answer, feedback }: { answer: string; feedback: AnswerFeedback }) {
  return (
    <section className={`card ${styles.feedback}`} aria-label="Feedback on your answer">
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
              <h3 className={styles.listTitle}>What worked</h3>
              <ul className={styles.points} data-tone="good">
                {feedback.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {feedback.improvements.length ? (
            <div>
              <h3 className={styles.listTitle}>To improve</h3>
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
            <h3 className={styles.listTitle}>A stronger answer would cover</h3>
            <ul className={styles.points} data-tone="ice">
              {feedback.stronger_answer.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <details className={styles.yourAnswer}>
          <summary>Your answer</summary>
          <p>{answer}</p>
        </details>
      </div>
    </section>
  );
}

function ReportView(props: { sessionId: string; report: PracticeReport; questions: PracticeQuestion[] }) {
  const { report } = props;
  const overall = report.overall_score ?? 0;
  const signal = report.hiring_signal ? (SIGNALS[report.hiring_signal] ?? report.hiring_signal) : null;
  const tone = overall >= 75 ? 'good' : overall >= 50 ? 'fair' : 'low';

  return (
    <div className={styles.report}>
      <section className={`card ${styles.reportHero}`} aria-label="Overall result">
        <div className="cardInner">
          <div className={styles.heroRow}>
            <div className={styles.overall} data-tone={tone}>
              <span className={styles.overallNumber}>{overall}</span>
              <span className={styles.overallOf}>out of 100</span>
            </div>
            <div className={styles.heroText}>
              {signal ? <span className={`badge ${tone === 'good' ? 'badgeLive' : tone === 'fair' ? 'badgePro' : 'badgeAlert'}`}>{signal}</span> : null}
              {report.summary ? <p className={styles.summary}>{report.summary}</p> : null}
            </div>
          </div>
        </div>
      </section>

      {report.rubric ? (
        <section className="card" aria-label="Scores by area">
          <div className="cardInner stack">
            <h2 className="cardTitle">By area</h2>
            <ul className={styles.dimensions}>
              {DIMENSIONS.map(({ key, label }) => {
                const dimension = report.rubric?.[key];
                if (!dimension) return null;
                return (
                  <li key={key} className={styles.dimension}>
                    <div className={styles.dimensionHead}>
                      <span>{label}</span>
                      <span className={styles.meta}>{dimension.score} / 5</span>
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
        <ReportList title="Strengths" items={report.strengths} tone="good" />
        <ReportList title="To work on" items={report.weaknesses} tone="ember" />
        <ReportList title="Next steps" items={report.next_steps} tone="ice" ordered />
      </div>

      <section className="card" aria-label="Each answer">
        <div className="cardInner stack">
          <h2 className="cardTitle">Each answer</h2>
          <ol className={styles.breakdown}>
            {props.questions.map((q, i) => {
              const fb = q.rubric?.feedback;
              return (
                <li key={q.id}>
                  <details>
                    <summary className={styles.breakdownSummary}>
                      <span className={styles.breakdownIndex}>{i + 1}</span>
                      <span className={styles.breakdownQuestion}>{q.question_text}</span>
                      {fb ? (
                        <span className={styles.breakdownScore} data-tone={scoreTone(fb.score)}>
                          {fb.score}/10
                        </span>
                      ) : null}
                    </summary>
                    {fb ? <FeedbackPanel answer={q.response_text ?? ''} feedback={fb} /> : <p className="help">Not answered.</p>}
                  </details>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <div className={styles.actions}>
        <a className="button" href={`/api/interviews/${props.sessionId}/export`}>
          Export
        </a>
        <NewPracticeButton primary label="Practice again" />
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
