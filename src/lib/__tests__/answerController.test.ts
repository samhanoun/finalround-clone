import { AnswerController, type AnswerState } from '@/lib/copilot/answerController';
import type { GatedQuestion } from '@/lib/copilot/questionGate';

function question(text: string, trigger: GatedQuestion['trigger'] = 'gate'): GatedQuestion {
  return { text, category: 'other', trigger, via: trigger === 'manual' ? 'manual' : 'heuristic', score: 1, decidedAt: 0 };
}

/** A sender whose calls stay pending until the test settles them. */
function controllableSender() {
  const calls: Array<{ question: GatedQuestion; signal: AbortSignal; resolve: () => void; reject: (e: Error) => void }> = [];
  const send = jest.fn(
    (q: GatedQuestion, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ question: q, signal, resolve, reject });
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
  return { send, calls };
}

function track(controller: AnswerController) {
  const states: AnswerState[] = [];
  controller.subscribe((state) => states.push(state));
  return states;
}

describe('AnswerController', () => {
  it('answers a question and reports the result', async () => {
    const { send, calls } = controllableSender();
    const controller = new AnswerController(send);
    const states = track(controller);

    const done = controller.request(question('Why this role?'));
    expect(controller.getState()).toMatchObject({ status: 'answering', question: { text: 'Why this role?' } });
    calls[0].resolve();
    await done;

    expect(states.map((s) => s.status)).toEqual(['answering', 'answered']);
  });

  it('aborts the answer in flight when a newer question arrives', async () => {
    const { send, calls } = controllableSender();
    const controller = new AnswerController(send);

    const first = controller.request(question('Tell me about a time'));
    const second = controller.request(question('Tell me about a time you failed.'));
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);

    calls[1].resolve();
    await Promise.all([first, second]);
    expect(controller.getState()).toMatchObject({
      status: 'answered',
      question: { text: 'Tell me about a time you failed.' },
      superseded: 1,
      error: null,
    });
  });

  it('ignores a late result from a replaced request', async () => {
    const calls: Array<() => void> = [];
    const controller = new AnswerController(
      () => new Promise<void>((resolve) => calls.push(resolve)), // ignores abort, like a slow server
    );
    const first = controller.request(question('First?'));
    const second = controller.request(question('Second?'));
    calls[1]();
    await second;
    calls[0]();
    await first;

    expect(controller.getState()).toMatchObject({ status: 'answered', question: { text: 'Second?' } });
  });

  it('shows the error for the latest question only', async () => {
    const { send, calls } = controllableSender();
    const controller = new AnswerController(send);
    const done = controller.request(question('Why?'));
    calls[0].reject(new Error('Answers are not set up on the server.'));
    await done;

    expect(controller.getState()).toMatchObject({ status: 'error', error: 'Answers are not set up on the server.' });
  });

  it('stops the answer in flight but keeps the question on screen', async () => {
    const { send, calls } = controllableSender();
    const controller = new AnswerController(send);
    const done = controller.request(question('How would you scale it?', 'manual'));
    controller.cancel();
    await done;

    expect(calls[0].signal.aborted).toBe(true);
    expect(controller.getState()).toMatchObject({ status: 'idle', question: { text: 'How would you scale it?' }, error: null });
  });

  it('accumulates streamed text and ignores late pieces from a replaced request', async () => {
    const senders: Array<(text: string) => void> = [];
    const finishers: Array<() => void> = [];
    const controller = new AnswerController(
      (_q, _signal, onText) =>
        new Promise<{ ttftMs: number }>((resolve) => {
          senders.push(onText);
          finishers.push(() => resolve({ ttftMs: 410 }));
        }),
    );
    const first = controller.request(question('Tell me about a time'));
    senders[0]('I once ');
    const second = controller.request(question('Tell me about a time you failed.'));
    senders[0]('stale words');
    senders[1]('I shipped a bug, ');
    senders[1]('then fixed the process.');
    finishers[1]();
    await second;
    finishers[0]();
    await first;

    expect(controller.getState()).toMatchObject({
      status: 'answered',
      text: 'I shipped a bug, then fixed the process.',
      ttftMs: 410,
    });
  });
});
