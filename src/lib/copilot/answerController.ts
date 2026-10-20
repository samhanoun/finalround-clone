import type { GatedQuestion } from './questionGate';

export type AnswerStatus = 'idle' | 'answering' | 'answered' | 'error';

export type AnswerState = {
  status: AnswerStatus;
  question: GatedQuestion | null;
  error: string | null;
  /** How many in-flight answers a newer question replaced this session. */
  superseded: number;
};

export type AnswerSender = (question: GatedQuestion, signal: AbortSignal) => Promise<void>;

const IDLE: AnswerState = { status: 'idle', question: null, error: null, superseded: 0 };

/**
 * One answer at a time: a new question (from the gate or Answer now) aborts
 * the answer in flight, so only the latest question ever finishes.
 */
export class AnswerController {
  private readonly send: AnswerSender;
  private inFlight: AbortController | null = null;
  private seq = 0;
  private state: AnswerState = IDLE;
  private readonly listeners = new Set<(state: AnswerState) => void>();

  constructor(send: AnswerSender) {
    this.send = send;
  }

  getState(): AnswerState {
    return this.state;
  }

  subscribe(listener: (state: AnswerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(question: GatedQuestion): Promise<void> {
    const replacing = this.inFlight !== null;
    this.inFlight?.abort();
    const abort = new AbortController();
    this.inFlight = abort;
    const seq = ++this.seq;
    this.update({
      status: 'answering',
      question,
      error: null,
      superseded: this.state.superseded + (replacing ? 1 : 0),
    });

    try {
      await this.send(question, abort.signal);
      if (seq === this.seq) this.update({ ...this.state, status: 'answered' });
    } catch (e) {
      if (seq !== this.seq || abort.signal.aborted) return; // replaced or stopped
      this.update({ ...this.state, status: 'error', error: e instanceof Error ? e.message : 'Could not get an answer.' });
    } finally {
      if (this.inFlight === abort) this.inFlight = null;
    }
  }

  /** Stop: abort the answer in flight and keep showing its question. */
  cancel(): void {
    if (!this.inFlight) return;
    this.inFlight.abort();
    this.inFlight = null;
    this.seq += 1;
    this.update({ ...this.state, status: 'idle' });
  }

  reset(): void {
    this.inFlight?.abort();
    this.inFlight = null;
    this.seq += 1;
    this.update(IDLE);
  }

  private update(next: AnswerState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
