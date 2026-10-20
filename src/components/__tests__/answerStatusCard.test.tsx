import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { AnswerStatusCard } from '@/components/copilot/AnswerStatusCard';
import type { CopilotAnswers } from '@/components/copilot/useCopilotAnswers';
import { IDLE_ANSWER, type AnswerState } from '@/lib/copilot/answerController';

/** A tiny store like the hook's: tests can push new states while the card is mounted. */
function answers(initial: Partial<AnswerState>) {
  let state: AnswerState = { ...IDLE_ANSWER, ...initial };
  const listeners = new Set<() => void>();
  const value: CopilotAnswers = {
    observe: jest.fn(),
    answerNow: jest.fn(),
    addTypedLine: jest.fn(),
    stop: jest.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
  };
  const push = (next: Partial<AnswerState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  return Object.assign(value, { push });
}

const QUESTION = {
  text: 'Tell me about a time you failed.',
  category: 'behavioral' as const,
  trigger: 'gate' as const,
  via: 'heuristic' as const,
  score: 0.9,
  decidedAt: 0,
};

describe('AnswerStatusCard', () => {
  it('explains how questions are picked up before the first one', () => {
    render(<AnswerStatusCard answers={answers({})} onAnswerNow={jest.fn()} disabled={false} />);
    expect(screen.getByText('Waiting for a question')).toBeInTheDocument();
    expect(screen.getByText(/press/)).toBeInTheDocument();
  });

  it('shows the question being answered, its category and a Stop button', () => {
    const value = answers({ status: 'answering', question: QUESTION, superseded: 1 });
    render(<AnswerStatusCard answers={value} onAnswerNow={jest.fn()} disabled={false} />);

    expect(screen.getByText('Answering…')).toBeInTheDocument();
    expect(screen.getByText('Tell me about a time you failed.')).toBeInTheDocument();
    expect(screen.getByText('Behavioral')).toBeInTheDocument();
    expect(screen.getByText(/1 earlier answer was replaced/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(value.stop).toHaveBeenCalled();
  });

  it('runs Answer now and hides Stop once answered', () => {
    const onAnswerNow = jest.fn();
    render(<AnswerStatusCard answers={answers({ status: 'answered', question: QUESTION })} onAnswerNow={onAnswerNow} disabled={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Answer now' }));
    expect(onAnswerNow).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('shows errors and disables Answer now outside an active session', () => {
    render(<AnswerStatusCard answers={answers({ status: 'error', error: 'Answers are not set up.' })} onAnswerNow={jest.fn()} disabled />);
    expect(screen.getByText('Answers are not set up.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Answer now' })).toBeDisabled();
  });

  it('shows the answer as it streams in, without the page re-rendering', () => {
    const value = answers({ status: 'answering', question: QUESTION });
    render(<AnswerStatusCard answers={value} onAnswerNow={jest.fn()} disabled={false} />);
    expect(screen.getByText('Writing an answer…')).toBeInTheDocument();

    act(() => value.push({ text: 'I led the payments migration.' }));
    expect(screen.getByLabelText('Suggested answer')).toHaveTextContent('I led the payments migration.');

    act(() => value.push({ text: 'I led the payments migration.\n- Cut latency 40%', status: 'answered', ttftMs: 420 }));
    expect(screen.getByText('Answered · first words in 420 ms')).toBeInTheDocument();
    expect(screen.getByLabelText('Suggested answer')).toHaveTextContent('Cut latency 40%');
  });
});
