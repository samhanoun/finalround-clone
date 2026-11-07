import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { LiveCopilotClient } from '@/components/LiveCopilotClient';
import type { AudioCapture } from '@/components/copilot/useAudioCapture';
import type { CopilotAnswers } from '@/components/copilot/useCopilotAnswers';
import { IDLE_ANSWER } from '@/lib/copilot/answerController';

// Audio, transcription and answers are their own tested units; here they are
// stand-ins so the page's wiring can be checked.
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

const mockGrab = jest.fn(async () => ({ jpegBase64: 'frame', width: 1600, height: 900, bytes: 1234 }));
jest.mock('@/lib/copilot/screenFrame', () => ({ grabScreenFrame: () => mockGrab(), screenSignature: jest.fn() }));

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
const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/copilot/sessions/start') return reply({ session: SESSION });
  if (url === '/api/copilot/sessions/stop') return reply({ session: { ...SESSION, status: 'stopped', stopped_at: new Date().toISOString() }, reason: init?.body });
  if (url.endsWith('/heartbeat')) return reply({ state: 'active' });
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
  mockGrab.mockClear();
  (mockAnswers.answerScreen as jest.Mock).mockClear();
  mockCapture.status = 'idle';
  window.localStorage.clear();
  delete (window as unknown as { apexDesktop?: unknown }).apexDesktop;
});

async function startSession(onSessionChange = jest.fn()) {
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
  await screen.findByRole('button', { name: 'Stop session' });
  return onSessionChange;
}

const meeting = (state: 'started' | 'ended', app = 'Zoom') =>
  act(() => {
    window.dispatchEvent(new CustomEvent('apex-desktop:meeting', { detail: { state, app } }));
  });

describe('LiveCopilotClient', () => {
  it('shows a focused setup before a session: no empty transcript, answers or tools, no support panels', async () => {
    const onSessionChange = jest.fn();
    render(<LiveCopilotClient onSessionChange={onSessionChange} />);
    expect(screen.getByRole('region', { name: 'Session setup' })).toBeInTheDocument();
    await screen.findByRole('option', { name: 'None' });

    expect(screen.queryByText('Transcript and answers')).not.toBeInTheDocument();
    expect(screen.queryByText('More tools')).not.toBeInTheDocument();
    expect(screen.queryByText(/Diagnostics/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Past sessions' })).toHaveAttribute('aria-expanded', 'false');
    expect(onSessionChange).toHaveBeenLastCalledWith(false);
  });

  it('puts the answer card first during a session, with the talk track, the transcript and the tools', async () => {
    const onSessionChange = jest.fn();
    render(<LiveCopilotClient onSessionChange={onSessionChange} />);
    await startSession();

    expect(onSessionChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('region', { name: 'Session setup' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Staff Engineer at Acme' })).toHaveFocus();
    const card = screen.getByRole('region', { name: 'Current question' });
    expect(within(card).getByRole('button', { name: 'Answer now' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Solve screen' })).toBeDisabled();
    expect(within(card).getByRole('checkbox', { name: 'Auto' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Audio sources' })).getByRole('button', { name: 'Start listening' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transcript and answers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Type a line' })).toHaveAttribute('aria-expanded', 'false');

    // The phone bar: Answer now, Solve screen and the listen toggle.
    const bar = screen.getByRole('group', { name: 'Session controls' });
    expect(within(bar).getByRole('button', { name: 'Answer now' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Solve screen' })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Start listening' }));
    expect(mockCapture.start).toHaveBeenCalled();

    // Support panels stay out of sight without ?debug=1.
    expect(screen.queryByText(/Latency/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Events:/)).not.toBeInTheDocument();
  });

  it('opens Type a line on Ctrl+K and focuses it', async () => {
    render(<LiveCopilotClient />);
    await startSession();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const field = await screen.findByRole('textbox', { name: 'Type a line' });
    expect(field).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Insert a line to buy time' })).toBeInTheDocument();
  });

  it('shows the support panels with ?debug=1', async () => {
    render(<LiveCopilotClient debug />);
    expect(screen.getByText(/Diagnostics/)).toBeInTheDocument();
    await startSession();
    expect(screen.getByText(/questions this session/)).toBeInTheDocument();
    expect(screen.getByText(/Events:/)).toBeInTheDocument();
  });

  it('offers to start when the desktop app sees a meeting app take the microphone', async () => {
    render(<LiveCopilotClient />);
    meeting('started');
    expect(screen.getByRole('status')).toHaveTextContent('Zoom is in a meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }));
    await screen.findByRole('button', { name: 'Stop session' });
    expect(screen.queryByText('Zoom is in a meeting')).not.toBeInTheDocument();
  });

  it('counts down when the meeting app lets go of the microphone, and ends the session like Stop session', async () => {
    render(<LiveCopilotClient />);
    await startSession();

    meeting('ended');
    expect(screen.getByRole('alert')).toHaveTextContent('Zoom stopped using the microphone. The session ends in 30 s');
    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    meeting('ended');
    fireEvent.click(screen.getByRole('button', { name: 'End now' }));
    await screen.findByRole('region', { name: 'Session setup' });
    const stop = fetchMock.mock.calls.find(([url]) => url === '/api/copilot/sessions/stop');
    expect(JSON.parse(String(stop?.[1]?.body))).toEqual({ sessionId: 'session-1', reason: 'user' });
    // The last session's lines would show below the setup; with none, nothing is left over.
    expect(screen.queryByText('Transcript and answers')).not.toBeInTheDocument();
  });

  it('hides the desktop app’s answer window while Solve screen grabs the frame', async () => {
    const order: string[] = [];
    (window as unknown as { apexDesktop: unknown }).apexDesktop = {
      isDesktop: true,
      platform: 'win32',
      hideForCapture: jest.fn(async () => {
        order.push('hide');
      }),
      showAfterCapture: jest.fn(async () => {
        order.push('show');
      }),
    };
    mockGrab.mockImplementation(async () => {
      order.push('grab');
      return { jpegBase64: 'frame', width: 1600, height: 900, bytes: 1234 };
    });
    mockCapture.status = 'live';
    (mockCapture.getDisplayVideoTrack as jest.Mock).mockReturnValue({ readyState: 'live' });

    render(<LiveCopilotClient />);
    await startSession();
    const card = screen.getByRole('region', { name: 'Current question' });
    fireEvent.click(within(card).getByRole('button', { name: 'Solve screen' }));

    await waitFor(() => expect(mockAnswers.answerScreen).toHaveBeenCalledWith(expect.objectContaining({ jpegBase64: 'frame' })));
    expect(order).toEqual(['hide', 'grab', 'show']);
    (mockCapture.getDisplayVideoTrack as jest.Mock).mockReturnValue(null);
  });
});
