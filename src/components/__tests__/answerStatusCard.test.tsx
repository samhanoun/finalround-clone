import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { AnswerStatusCard } from '@/components/copilot/AnswerStatusCard';
import type { CopilotAnswers } from '@/components/copilot/useCopilotAnswers';
import type { AnswerState } from '@/lib/copilot/answerController';

function answers(state: Partial<AnswerState>): CopilotAnswers {
  return {
    state: { status: 'idle', question: null, error: null, superseded: 0, ...state },
    observe: jest.fn(),
    answerNow: jest.fn(),
    stop: jest.fn(),
  };
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
});
