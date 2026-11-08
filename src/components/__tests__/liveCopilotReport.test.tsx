import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { LiveCopilotClient } from '@/components/LiveCopilotClient';
import type { AudioCapture } from '@/components/copilot/useAudioCapture';
import type { CopilotAnswers } from '@/components/copilot/useCopilotAnswers';
import { IDLE_ANSWER } from '@/lib/copilot/answerController';

// The session summary and the Past sessions report. Audio, transcription and
// answers are stand-ins, as in liveCopilotClient.test.tsx.
const mockCapture: AudioCapture = {
  status: 'idle',
  error: null,
  ended: null,
  start: jest.fn(async () => undefined),
  stop: jest.fn(),
  subscribeFrames: jest.fn(() => () => undefined),
  subscribeLevels: jest.fn(() => () => undefined),
  getDisplayVideoTrack: jest.fn(() => null),
};
// One t() per namespace across renders, as next-intl does (effects list t as a dependency).
jest.mock('next-intl', () => {
  const intl = jest.requireActual<typeof import('next-intl')>('next-intl');
  const translators = new Map<string | undefined, ReturnType<typeof intl.useTranslations>>();
  return {
    ...intl,
    useTranslations: (namespace?: string) => {
      if (!translators.has(namespace)) translators.set(namespace, intl.useTranslations(namespace as never));
      return translators.get(namespace)!;
    },
  };
});
jest.mock('@/components/copilot/useAudioCapture', () => ({ useAudioCapture: () => mockCapture }));
jest.mock('@/components/copilot/useLiveTranscription', () => ({
  useLiveTranscription: () => ({ status: 'idle', error: null, errorCode: null, captions: { candidate: '', interviewer: '' } }),
}));
jest.mock('@/components/copilot/useVoiceSample', () => ({
  useVoiceSample: () => ({ state: 'none', progress: 0, tooQuiet: false, record: jest.fn(), cancel: jest.fn(), forget: jest.fn(), resolver: null }),
}));
const mockNoTurns: ReturnType<CopilotAnswers['getTurns']> = [];
const mockAnswers: CopilotAnswers = {
  observe: jest.fn(),
  answerNow: jest.fn(() => true),
  answerScreen: jest.fn(() => true),
  addTypedLine: jest.fn(),
  stop: jest.fn(),
  subscribe: () => () => undefined,
  getState: () => IDLE_ANSWER,
  subscribeTurns: () => () => undefined,
  getTurns: () => mockNoTurns,
};
jest.mock('@/components/copilot/useCopilotAnswers', () => ({ useCopilotAnswers: () => mockAnswers }));
jest.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'not', 'eq', 'order', 'limit']) builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
      return builder;
    },
  }),
}));

const SESSION = {
  id: 'session-1',
  status: 'active',
  title: 'Staff Engineer at Acme',
  started_at: new Date().toISOString(),
  stopped_at: null,
  consumed_minutes: 0,
  metadata: { mode: 'general' },
};

const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let summarizeReplies: Array<ReturnType<typeof reply>> = [];
let reportReply = reply({ error: 'report_not_found' }, 404);
const fetchMock = jest.fn(async (url: string) => {
  if (url === '/api/copilot/sessions/start') return reply({ session: SESSION });
  if (url.endsWith('/heartbeat')) return reply({ state: 'active' });
  if (url.endsWith('/summarize')) return summarizeReplies.shift() ?? reply({}, 500);
  if (url === '/api/copilot/sessions/history') {
    return reply({
      sessions: [
        { ...SESSION, id: 'old-1', status: 'stopped', stopped_at: '2026-11-01T10:20:00Z', started_at: '2026-11-01T10:00:00Z', created_at: '2026-11-01T10:00:00Z' },
      ],
    });
  }
  if (url.endsWith('/report')) return reportReply;
  if (url === '/api/copilot/sessions/old-1') {
    return reply({ session: { ...SESSION, id: 'old-1', status: 'stopped' }, events: [], summaries: [] });
  }
  return reply({}, 404);
});

class FakeEventSource {
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
});

beforeEach(() => {
  fetchMock.mockClear();
  summarizeReplies = [];
  reportReply = reply({ error: 'report_not_found' }, 404);
  window.localStorage.clear();
});

async function openSummary() {
  render(<LiveCopilotClient />);
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByRole('button', { name: 'Stop session' });
  fireEvent.click(screen.getByRole('button', { name: /^Session summary/ }));
}

describe('LiveCopilotClient: the session report', () => {
  it('saves no stand-in when the summary fails: it says so and offers Try again', async () => {
    summarizeReplies = [
      reply({ error: 'summary_failed', extra: { requestId: 'req-1' } }, 502),
      reply({ summary: { content: 'Specific answers.', payload: { strengths: ['Uses numbers'], weaknesses: [], next_steps: ['P1: Name a trade-off'] } } }),
    ];
    await openSummary();

    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect(await screen.findByText("The summary didn't come through, and nothing was saved.")).toBeInTheDocument();
    // No report appears.
    expect(screen.queryByText('Uses numbers')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Uses numbers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate again' })).toBeInTheDocument();
    expect(screen.queryByText("The summary didn't come through, and nothing was saved.")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/summarize'))).toHaveLength(2);
  });

  it('says when no model is set up, and when there is no transcript yet', async () => {
    summarizeReplies = [reply({ error: 'summary_unavailable' }, 503), reply({ error: 'no_events' }, 400)];
    await openSummary();

    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }));
    expect(await screen.findByText("No AI model is set up for this app yet, so there's no summary. Nothing was saved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText("There's nothing to summarize yet. Add a few transcript lines first.")).toBeInTheDocument();
  });

  it('shows a rubric area the model didn’t score as not captured, without a score or stock advice', async () => {
    const empty = { score: null, evidence: '', recommendation: '' };
    reportReply = reply({
      report: {
        overall_score: 70,
        hiring_signal: 'lean_hire',
        summary: 'Clear and specific.',
        strengths: ['Uses numbers'],
        weaknesses: [],
        next_steps: [],
        rubric: {
          communication: { score: 4, evidence: 'Clear openings', recommendation: 'Shorter wrap-ups' },
          technical_accuracy: empty,
          problem_solving: empty,
          structure: { score: null, evidence: 'Too little in the log', recommendation: '' },
          ownership: empty,
          role_fit: empty,
        },
      },
    });
    render(<LiveCopilotClient />);
    fireEvent.click(screen.getByRole('button', { name: 'Past sessions' }));
    const detail = screen.getByRole('region', { name: 'Session detail view' });
    await within(detail).findByText('Clear and specific.');

    const row = (name: string) => within(detail).getByText(name, { selector: 'span' }).closest('li')!;
    expect(row('Communication')).toHaveTextContent('4/5');
    expect(row('Communication')).toHaveTextContent('Clear openings');
    for (const name of ['Technical accuracy', 'Problem solving', 'Ownership', 'Role fit']) {
      expect(row(name)).toHaveTextContent(`${name}Not captured`);
      expect(row(name)).not.toHaveTextContent('/5');
      expect(row(name).querySelector('[aria-hidden="true"]')).toBeNull();
    }
    // The model's reason for not scoring an area is kept.
    expect(row('Structure')).toHaveTextContent('Too little in the log');
    expect(row('Structure')).not.toHaveTextContent('/5');
  });
});
