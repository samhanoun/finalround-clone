'use client';

import { useSyncExternalStore } from 'react';
import type { QuestionCategory } from '@/lib/copilot/questionGate';
import type { CopilotAnswers } from './useCopilotAnswers';
import styles from './AnswerStatusCard.module.css';

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

export function AnswerStatusCard({
  answers,
  onAnswerNow,
  disabled,
}: {
  answers: CopilotAnswers;
  onAnswerNow: () => void;
  disabled: boolean;
}) {
  // Subscribes here, not in the page, so streamed text only re-renders this card.
  const state = useSyncExternalStore(answers.subscribe, answers.getState, answers.getState);
  const { question } = state;
  const waitingForText = state.status === 'answering' && !state.text;

  return (
    <section className={styles.card} aria-label="Current question">
      <div className={styles.header}>
        <h3 className={styles.title}>Current question</h3>
        <span className="badge" role="status" aria-live="polite">
          {STATUS_LABEL[state.status]}
          {state.status === 'answered' && state.ttftMs != null ? ` · first words in ${state.ttftMs} ms` : ''}
        </span>
      </div>

      {question ? (
        <div className={styles.question}>
          <span className="badge">{CATEGORY_LABEL[question.category]}</span>
          <p className={styles.questionText}>{question.text}</p>
          <span className="small">
            {question.trigger === 'manual' ? 'You asked for this answer.' : 'Detected automatically.'}
            {state.superseded > 0
              ? ` ${state.superseded} earlier ${state.superseded === 1 ? 'answer was' : 'answers were'} replaced by a newer question.`
              : ''}
          </span>
        </div>
      ) : (
        <p className={`small ${styles.empty}`}>
          Questions from the interviewer are picked up automatically. If one is missed, press <kbd>A</kbd> or use
          Answer now.
        </p>
      )}

      {state.text || waitingForText ? (
        <div className={styles.answer} aria-label="Suggested answer" aria-busy={state.status === 'answering'}>
          {state.text || <span className={styles.waiting}>Writing an answer…</span>}
        </div>
      ) : null}

      {state.error ? (
        <div className="error" role="status">
          {state.error}
        </div>
      ) : null}

      <div className={styles.actions}>
        <button className="button buttonPrimary" type="button" onClick={onAnswerNow} disabled={disabled}>
          Answer now
        </button>
        {state.status === 'answering' ? (
          <button className="button" type="button" onClick={answers.stop}>
            Stop
          </button>
        ) : null}
      </div>
    </section>
  );
}
