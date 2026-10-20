import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { AnswerPanel } from '@/components/copilot/AnswerPanel';
import { AnswerView, type ConnectionState, type TailLine } from '@/components/copilot/AnswerView';
import type { CopilotAnswers } from '@/components/copilot/useCopilotAnswers';
import { copyDocumentStyles } from '@/components/copilot/useDocumentPip';
import { IDLE_ANSWER, type AnswerState } from '@/lib/copilot/answerController';

/** A tiny store like the hook's: tests can push new states while the view is mounted. */
function answers(initial: Partial<AnswerState> = {}) {
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
    subscribeTurns: () => () => undefined,
    getTurns: () => [],
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
const LIVE: ConnectionState = { label: 'Live', tone: 'live' };
const TAIL: TailLine[] = [
  { speaker: 'interviewer', text: 'Thanks for joining.' },
  { speaker: 'candidate', text: 'Happy to be here', live: true },
];

describe('AnswerView', () => {
  const props = { onAnswerNow: jest.fn(), disabled: false, connection: LIVE, tail: TAIL, fontPx: 16, onFontPx: jest.fn() };

  it('explains how questions are picked up before the first one', () => {
    render(<AnswerView answers={answers()} variant="inline" {...props} />);
    expect(screen.getByText('Waiting for a question')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Live');
    expect(screen.getByLabelText('Latest conversation')).toHaveTextContent('InterviewerThanks for joining.');
  });

  it('streams the answer in, shows the question, and stops on request', () => {
    const value = answers({ status: 'answering', question: QUESTION, superseded: 1 });
    render(<AnswerView answers={value} variant="inline" {...props} />);
    expect(screen.getByText('Writing an answer…')).toBeInTheDocument();
    expect(screen.getByText('Behavioral')).toBeInTheDocument();
    expect(screen.getByText(/1 earlier answer was replaced/)).toBeInTheDocument();

    act(() => value.push({ text: 'I shipped a bug.' }));
    expect(screen.getByLabelText('Suggested answer')).toHaveTextContent('I shipped a bug.');

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(value.stop).toHaveBeenCalled();

    act(() => value.push({ text: 'I shipped a bug.\n- Then fixed the process', status: 'answered', ttftMs: 420 }));
    expect(screen.getByText('Answered · first words in 420 ms')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('changes text size within limits and shows errors', () => {
    const onFontPx = jest.fn();
    render(<AnswerView answers={answers({ status: 'error', error: 'Answers are not set up.' })} variant="window" {...props} onFontPx={onFontPx} fontPx={26} />);
    expect(screen.getByText('Answers are not set up.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Larger text' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Smaller text' }));
    expect(onFontPx).toHaveBeenCalledWith(25);
    expect(screen.getByText(/Space or A: answer now/)).toBeInTheDocument();
  });
});

/**
 * A fake Document Picture-in-Picture window: an iframe gives a second document
 * with its own window, like the real floating window.
 */
function installFakePip() {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const frameWindow = iframe.contentWindow!;
  const pipDocument = iframe.contentDocument!;
  const pipWindow = {
    document: pipDocument,
    addEventListener: frameWindow.addEventListener.bind(frameWindow),
    dispatchEvent: frameWindow.dispatchEvent.bind(frameWindow),
    close: jest.fn(() => frameWindow.dispatchEvent(new (frameWindow as unknown as typeof globalThis).Event('pagehide'))),
  };
  const requestWindow = jest.fn(async () => pipWindow as unknown as Window);
  Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow } });
  return { pipDocument, pipWindow, requestWindow };
}

describe('AnswerPanel', () => {
  afterEach(() => {
    delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    document.querySelectorAll('iframe').forEach((frame) => frame.remove());
    window.localStorage.clear();
  });

  it('stays in the page, with a note, where Document Picture-in-Picture is missing', () => {
    render(<AnswerPanel answers={answers()} onAnswerNow={jest.fn()} disabled={false} connection={LIVE} tail={[]} />);
    expect(screen.getByLabelText('Current question')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pop out' })).not.toBeInTheDocument();
    expect(screen.getByText(/needs Chrome or Edge 116/)).toBeInTheDocument();
  });

  it('pops out into an always-on-top window that takes clicks and keys, and comes back', async () => {
    const { pipDocument, pipWindow, requestWindow } = installFakePip();
    const value = answers({ status: 'answered', question: QUESTION, text: 'I shipped a bug.' });
    const onAnswerNow = jest.fn();
    render(<AnswerPanel answers={value} onAnswerNow={onAnswerNow} disabled={false} connection={LIVE} tail={TAIL} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pop out' }));
    });

    expect(requestWindow).toHaveBeenCalledWith({ width: 420, height: 620 });
    expect(pipDocument.title).toBe('Apex Round · Answers');
    expect(screen.getByText(/showing in the floating window/)).toBeInTheDocument();
    const pip = within(pipDocument.body);
    expect(pip.getByLabelText('Suggested answer')).toHaveTextContent('I shipped a bug.');

    // React handles events inside the portal even though it's another document.
    fireEvent.click(pip.getByRole('button', { name: 'Answer now' }));
    expect(onAnswerNow).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(pipDocument.body, { key: 'a' });
    fireEvent.keyDown(pipDocument.body, { key: ' ' });
    expect(onAnswerNow).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(pip.getByRole('button', { name: 'Answer now' }), { key: ' ' }); // a focused button handles Space itself
    expect(onAnswerNow).toHaveBeenCalledTimes(3);

    fireEvent.keyDown(pipDocument.body, { key: 'Escape' });
    expect(value.stop).toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(pipDocument.body, { key: '+' });
    });
    expect((pipDocument.querySelector('[aria-label="Current question"]') as HTMLElement).style.getPropertyValue('--answer-font')).toBe('17px');
    expect(window.localStorage.getItem('apex.answerFontPx')).toBe('17');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bring back here' }));
    });
    expect(pipWindow.close).toHaveBeenCalled();
    expect(screen.getByLabelText('Suggested answer')).toHaveTextContent('I shipped a bug.');
  });

  it('notices when the user closes the floating window', async () => {
    const { pipWindow } = installFakePip();
    render(<AnswerPanel answers={answers()} onAnswerNow={jest.fn()} disabled={false} connection={LIVE} tail={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pop out' }));
    });
    expect(screen.getByRole('button', { name: 'Bring back here' })).toBeInTheDocument();

    act(() => {
      pipWindow.close();
    });
    expect(screen.getByRole('button', { name: 'Pop out' })).toBeInTheDocument();
  });

  it('closes the floating window when the session ends (panel unmounts)', async () => {
    const { pipWindow } = installFakePip();
    const { unmount } = render(<AnswerPanel answers={answers()} onAnswerNow={jest.fn()} disabled={false} connection={LIVE} tail={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pop out' }));
    });
    unmount();
    expect(pipWindow.close).toHaveBeenCalled();
  });
});

describe('copyDocumentStyles', () => {
  it('copies stylesheet rules, classes and theme into the floating window', () => {
    const style = document.createElement('style');
    style.textContent = '.answer { color: red; }';
    document.head.appendChild(style);
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.className = 'font-inter';

    const target = document.implementation.createHTMLDocument('pip');
    copyDocumentStyles(document, target);

    expect(target.head.textContent).toContain('.answer {color: red;}'.replace(' {', ' {'));
    expect(target.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(target.body.className).toBe('font-inter');

    style.remove();
    document.documentElement.removeAttribute('data-theme');
    document.body.className = '';
  });
});
