import type { TurnTiming } from './latency';
import type { GatedQuestion } from './questionGate';

export type AnswerStatus = 'idle' | 'answering' | 'answered' | 'error';

export type AnswerState = {
  status: AnswerStatus;
  question: GatedQuestion | null;
  /** The answer so far; grows while it streams. */
  text: string;
  error: string | null;
  /** How many in-flight answers a newer question replaced this session. */
  superseded: number;
  /** Time from request to first token, as the server measured it. */
  ttftMs: number | null;
};

export type AnswerResult = { model?: string; ttftMs?: number | null } | void;

export type AnswerSender = (
  question: GatedQuestion,
  signal: AbortSignal,
  onText: (text: string) => void,
) => Promise<AnswerResult>;

export const IDLE_ANSWER: AnswerState = {
  status: 'idle',
  question: null,
  text: '',
  error: null,
  superseded: 0,
  ttftMs: null,
};

/**
 * One answer at a time: a new question (from the gate, Answer now or a typed
 * line) aborts the answer in flight, so only the latest question finishes.
 */
type InFlight = { abort: AbortController; endedBy: 'superseded' | 'stopped' | null };

export class AnswerController {
  private readonly send: AnswerSender;
  private readonly now: () => number;
  private inFlight: InFlight | null = null;
  private seq = 0;
  private state: AnswerState = IDLE_ANSWER;
  private readonly listeners = new Set<(state: AnswerState) => void>();
  private readonly turnListeners = new Set<(turn: TurnTiming) => void>();

  constructor(send: AnswerSender, options: { now?: () => number } = {}) {
    this.send = send;
    this.now = options.now ?? (() => Date.now());
  }

  getState(): AnswerState {
    return this.state;
  }

  subscribe(listener: (state: AnswerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called once per question with its timing, however it ended. */
  onTurn(listener: (turn: TurnTiming) => void): () => void {
    this.turnListeners.add(listener);
    return () => this.turnListeners.delete(listener);
  }

  async request(question: GatedQuestion): Promise<void> {
    const replacing = this.inFlight !== null;
    this.endInFlight('superseded');
    const flight: InFlight = { abort: new AbortController(), endedBy: null };
    const { abort } = flight;
    this.inFlight = flight;
    const seq = ++this.seq;
    let firstTokenAt: number | null = null;
    this.update({
      status: 'answering',
      question,
      text: '',
      error: null,
      superseded: this.state.superseded + (replacing ? 1 : 0),
      ttftMs: null,
    });

    const onText = (text: string) => {
      if (seq !== this.seq || abort.signal.aborted) return;
      firstTokenAt ??= this.now();
      this.update({ ...this.state, text: this.state.text + text });
    };

    const report = (outcome: TurnTiming['outcome'], serverTtftMs: number | null, doneAt: number | null) => {
      const turn: TurnTiming = {
        category: question.category,
        trigger: question.trigger,
        via: question.via,
        outcome,
        speechEndedAt: question.speechEndedAt ?? null,
        finalAt: question.finalAt ?? null,
        gateAt: question.decidedAt,
        firstTokenAt,
        doneAt,
        serverTtftMs,
      };
      this.turnListeners.forEach((listener) => listener(turn));
    };

    try {
      const result = await this.send(question, abort.signal, onText);
      if (seq === this.seq) {
        this.update({ ...this.state, status: 'answered', ttftMs: result?.ttftMs ?? null });
        report('answered', result?.ttftMs ?? null, this.now());
      } else {
        report(flight.endedBy ?? 'superseded', null, null); // finished after being replaced
      }
    } catch (e) {
      if (seq !== this.seq || abort.signal.aborted) {
        report(flight.endedBy ?? 'stopped', null, null);
        return;
      }
      this.update({ ...this.state, status: 'error', error: e instanceof Error ? e.message : 'Could not get an answer.' });
      report('error', null, null);
    } finally {
      if (this.inFlight === flight) this.inFlight = null;
    }
  }

  /** Stop: abort the answer in flight and keep what has arrived so far. */
  cancel(): void {
    if (!this.inFlight) return;
    this.endInFlight('stopped');
    this.seq += 1;
    this.update({ ...this.state, status: 'idle' });
  }

  reset(): void {
    this.endInFlight('stopped');
    this.seq += 1;
    this.update(IDLE_ANSWER);
  }

  private endInFlight(reason: 'superseded' | 'stopped'): void {
    if (!this.inFlight) return;
    this.inFlight.endedBy = reason;
    this.inFlight.abort.abort();
    this.inFlight = null;
  }

  private update(next: AnswerState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
