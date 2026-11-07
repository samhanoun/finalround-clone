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

describe('PracticeInterview setup from a goal', () => {
  const RESUME_ID = '0b5c8c4e-7d1f-4c8e-9a43-2f6d1a7e9b10';
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('fills in the goal’s role, company, round, résumé and job, and starts with them', async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/question-bank')) return { ok: true, json: async () => ({ mine: [], shared: [] }) };
      return {
        ok: true,
        json: async () => ({
          questions: [question('q1', 'Walk me through a payments outage.')],
          setup: { role: 'Staff Engineer', type: 'technical', difficulty: 'medium', count: 5, followUps: true, hasResume: true, hasJob: true },
        }),
      };
    }) as unknown as typeof fetch;

    render(
      <PracticeInterview
        sessionId="s1"
        setup={null}
        questions={[]}
        report={null}
        resumes={[{ id: RESUME_ID, filename: 'cv.pdf' }]}
        prefill={{
          goalName: 'Acme staff role',
          role: 'Staff Engineer',
          company: 'Acme',
          type: 'technical',
          resumeDocumentId: RESUME_ID,
          jobDescription: 'Own payments reliability.',
        }}
      />,
    );
    expect(screen.getByText('Filled in from your goal “Acme staff role”. Change anything before you start.')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toHaveValue('Staff Engineer');
    expect(screen.getByLabelText('Company (optional)')).toHaveValue('Acme');
    expect(screen.getByLabelText(/Résumé \(optional\)/)).toHaveValue(RESUME_ID);
    expect(screen.getByLabelText(/Job description \(optional\)/)).toHaveValue('Own payments reliability.');

    fireEvent.click(screen.getByRole('button', { name: 'Start the interview' }));
    await waitFor(() => expect(spoken).toEqual(['Walk me through a payments outage.']));
    expect(calls.find((call) => call.url === '/api/interviews/s1/practice/start')?.body).toMatchObject({
      role: 'Staff Engineer',
      company: 'Acme',
      type: 'technical',
      resumeDocumentId: RESUME_ID,
      jobDescription: 'Own payments reliability.',
    });
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
