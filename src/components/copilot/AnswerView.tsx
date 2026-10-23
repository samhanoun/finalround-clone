'use client';

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { splitBullets, splitCodeFences } from '@/lib/copilot/answerText';
import type { QuestionCategory } from '@/lib/copilot/questionGate';
import type { CopilotAnswers } from './useCopilotAnswers';
import styles from './AnswerView.module.css';

const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  behavioral: 'Behavioral',
  technical: 'Technical',
  coding: 'Coding',
  system_design: 'System design',
  other: 'Question',
};

const STATUS_LABEL = {
  idle: 'Waiting for a question',
  answering: 'Answering…',
  answered: 'Answered',
  error: 'No answer',
} as const;

export type ConnectionState = { label: string; tone: 'live' | 'warn' | 'off' };
export type TailLine = { speaker: 'interviewer' | 'candidate'; text: string; live?: boolean };

export const MIN_FONT_PX = 13;
export const MAX_FONT_PX = 26;

/** Prose as text, fenced code as code blocks; partial while the answer streams. */
export function AnswerBody({ text }: { text: string }) {
  const segments = useMemo(() => splitCodeFences(text), [text]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'code' ? (
          <pre key={index} className={styles.code} data-lang={segment.lang || undefined}>
            <code>{segment.code}</code>
          </pre>
        ) : (
          <div key={index} className={styles.prose}>
            {splitBullets(segment.text).map((block, blockIndex) =>
              block.kind === 'points' ? (
                <ul key={blockIndex} className={styles.points}>
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={blockIndex} className={styles.line}>
                  {block.text}
                </p>
              ),
            )}
          </div>
        ),
      )}
    </>
  );
}

/**
 * The answer as the candidate reads it mid-interview: the question, the
 * streaming answer, and the last few lines of conversation. Rendered in the
 * page or in the floating Picture-in-Picture window.
 */
export function AnswerView({
  answers,
  onAnswerNow,
  disabled,
  variant,
  connection,
  tail,
  fontPx,
  onFontPx,
  actions,
  onSolveScreen,
  screenDisabled = false,
}: {
  answers: CopilotAnswers;
  onAnswerNow: () => void;
  disabled: boolean;
  variant: 'inline' | 'window';
  connection: ConnectionState;
  tail: TailLine[];
  fontPx: number;
  onFontPx: (px: number) => void;
  actions?: ReactNode;
  /** Solve screen: answer from a frame of the shared tab or screen. */
  onSolveScreen?: () => void;
  screenDisabled?: boolean;
}) {
  // Subscribes here, not in the page, so streamed text only re-renders this view.
  const state = useSyncExternalStore(answers.subscribe, answers.getState, answers.getState);
  const { question } = state;
  const waitingForText = state.status === 'answering' && !state.text;

  return (
    <section
      className={`${styles.view} ${variant === 'window' ? styles.window : styles.inline}`}
      aria-label="Current question"
      style={{ ['--answer-font' as string]: `${fontPx}px` }}
    >
      <header className={styles.header}>
        <span className={`${styles.pill} ${styles[connection.tone]}`} role="status" aria-live="polite">
          {connection.label}
        </span>
        <span className="badge">
          {STATUS_LABEL[state.status]}
          {state.status === 'answered' && state.ttftMs != null ? ` · first words in ${state.ttftMs} ms` : ''}
        </span>
        {actions ? <span className={styles.headerActions}>{actions}</span> : null}
      </header>

      {question ? (
        <div className={styles.question}>
          <span className="badge">{question.via === 'screen' ? 'Screen' : CATEGORY_LABEL[question.category]}</span>
          <p className={styles.questionText}>{question.text}</p>
          {state.superseded > 0 && variant === 'inline' ? (
            <span className="small">
              {state.superseded} earlier {state.superseded === 1 ? 'answer was' : 'answers were'} replaced by a newer question.
            </span>
          ) : null}
        </div>
      ) : (
        <p className={`small ${styles.empty}`}>
          Questions from the interviewer are picked up automatically. If one is missed, press <kbd>A</kbd> or use Answer now.
        </p>
      )}

      {state.text || waitingForText ? (
        <div className={styles.answer} aria-label="Suggested answer" aria-busy={state.status === 'answering'}>
          {state.text ? <AnswerBody text={state.text} /> : <span className={styles.waiting}>Writing an answer…</span>}
        </div>
      ) : null}

      {state.error ? (
        <div className="error" role="status">
          {state.error}
        </div>
      ) : null}

      {tail.length > 0 ? (
        <ol className={styles.tail} aria-label="Latest conversation">
          {tail.map((line, index) => (
            <li
              key={`${index}-${line.speaker}`}
              className={line.live ? styles.liveLine : undefined}
              data-voice={line.speaker === 'interviewer' ? 'interviewer' : 'you'}
            >
              <span className={styles.speaker}>{line.speaker === 'interviewer' ? 'Interviewer' : 'You'}</span>
              <span>{line.text}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <footer className={styles.controls}>
        <button className="button buttonPrimary" type="button" onClick={onAnswerNow} disabled={disabled}>
          Answer now
        </button>
        {onSolveScreen ? (
          <button
            className="button"
            type="button"
            onClick={onSolveScreen}
            disabled={disabled || screenDisabled}
            title="Read the shared tab or screen and solve what's on it"
          >
            Solve screen
          </button>
        ) : null}
        {state.status === 'answering' ? (
          <button className="button" type="button" onClick={answers.stop}>
            Stop
          </button>
        ) : null}
        <span className={styles.fontControls} role="group" aria-label="Text size">
          <button
            className="button"
            type="button"
            onClick={() => onFontPx(fontPx - 1)}
            disabled={fontPx <= MIN_FONT_PX}
            aria-label="Smaller text"
          >
            A−
          </button>
          <button
            className="button"
            type="button"
            onClick={() => onFontPx(fontPx + 1)}
            disabled={fontPx >= MAX_FONT_PX}
            aria-label="Larger text"
          >
            A+
          </button>
        </span>
      </footer>

      {variant === 'window' ? (
        <p className={`small ${styles.hint}`}>
          Space or A: answer now{onSolveScreen ? ' · S: solve screen' : ''} · Esc: stop · + / −: text size
        </p>
      ) : null}
    </section>
  );
}
