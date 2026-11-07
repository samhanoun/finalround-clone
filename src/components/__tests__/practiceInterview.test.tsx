import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { PracticeInterview, type PracticeQuestion } from '@/components/practice/PracticeInterview';
import { pickVoice } from '@/components/practice/useInterviewerVoice';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }));

const spoken: string[] = [];
const synth = {
  speak: jest.fn((utterance: { text: string; onstart?: () => void }) => {
    spoken.push(utterance.text);
    utterance.onstart?.();
  }),
  cancel: jest.fn(),
  getVoices: jest.fn(() => []),
};

class FakeUtterance {
  lang = '';
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

function question(id: string, text: string, extra: Partial<PracticeQuestion> = {}): PracticeQuestion {
  return {
    id,
    question_text: text,
    question_type: 'behavioral',
    difficulty: 'medium',
    order_index: 0,
    response_text: null,
    response_score: null,
    rubric: null,
    answered_at: null,
    ...extra,
  };
}

const FEEDBACK = { score: 6, verdict: 'Solid but vague.', strengths: ['clear'], improvements: ['numbers'], stronger_answer: ['impact'] };

beforeEach(() => {
  spoken.length = 0;
  jest.clearAllMocks();
  Object.assign(window, { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
  window.localStorage.clear();
});

afterEach(() => {
  delete (window as Partial<typeof window>).speechSynthesis;
  delete (window as Partial<typeof window>).SpeechSynthesisUtterance;
});

function renderInterview(questions: PracticeQuestion[]) {
  return render(
    <PracticeInterview
      sessionId="s1"
      setup={{ role: 'Engineer', type: 'behavioral', difficulty: 'medium', count: 3, followUps: true, hasResume: false, hasJob: false }}
      questions={questions}
      report={null}
      resumes={[]}
    />,
  );
}

describe('PracticeInterview', () => {
  it('reads the question aloud, and can repeat it or be muted', async () => {
    renderInterview([question('q1', 'Tell me about a hard deadline.')]);
    await waitFor(() => expect(spoken).toEqual(['Tell me about a hard deadline.']));
    expect(screen.getByRole('img', { name: 'The interviewer is asking the question' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mute the interviewer' }));
    expect(synth.cancel).toHaveBeenCalled();
    expect(window.localStorage.getItem('practice.interviewerMuted')).toBe('1');
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeDisabled();
  });

  it('brings in the follow-up after the answer, and lets you skip it', async () => {
    const followUp = question('f1', 'Which part of that deadline did you own?', { rubric: { follow_up_of: 'q1' } });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ questionId: 'q1', answeredAt: '2026-10-26T10:00:00Z', feedback: FEEDBACK, followUp }),
    })) as unknown as typeof fetch;

    renderInterview([question('q1', 'Tell me about a hard deadline.'), question('q2', 'Why this team?', { order_index: 1 })]);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'We shipped on time by cutting scope.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    });

    expect(await screen.findByText('Solid but vague.')).toBeInTheDocument();
    expect(screen.getByText('The interviewer has a follow-up question about your answer.')).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Answer the follow-up' }));
    expect(screen.getByText('Which part of that deadline did you own?')).toBeInTheDocument();
    expect(screen.getByText('Follow-up')).toBeInTheDocument();
    await waitFor(() => expect(spoken).toContain('Which part of that deadline did you own?'));

    fireEvent.click(screen.getByRole('button', { name: 'Skip the follow-up' }));
    expect(screen.getByText('Why this team?')).toBeInTheDocument();
  });
});

describe('pickVoice', () => {
  const voice = (lang: string, localService = false) => ({ lang, localService, name: lang }) as SpeechSynthesisVoice;

  it('prefers the same locale, then the same language, and gives up otherwise', () => {
    expect(pickVoice([voice('en-GB'), voice('fr-FR'), voice('fr-CA', true)], 'fr-FR')?.lang).toBe('fr-FR');
    expect(pickVoice([voice('en-GB'), voice('fr-CA', true)], 'fr')?.lang).toBe('fr-CA');
    expect(pickVoice([voice('en-GB')], 'de')).toBeNull();
  });
});
