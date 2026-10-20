import type { SpeakerRole, TranscriptResult } from './deepgramLive';

export type Utterance = {
  role: SpeakerRole;
  text: string;
  startSec: number;
  endSec: number;
  /** When the last piece of the utterance arrived (ms since epoch). */
  completedAt: number;
};

type SpeakerState = {
  finals: string[];
  startSec: number | null;
  endSec: number;
  interim: string;
  /** UtteranceEnd arrived before the last words were final: commit on the next final. */
  commitOnNextFinal: boolean;
};

const ROLES: SpeakerRole[] = ['candidate', 'interviewer'];

function emptyState(): SpeakerState {
  return { finals: [], startSec: null, endSec: 0, interim: '', commitOnNextFinal: false };
}

/**
 * Turns Deepgram's stream of interim and final pieces into whole utterances,
 * one per speaker turn. An utterance closes on `speech_final` (or our own
 * Finalize when the channel went quiet) or on UtteranceEnd.
 */
export class UtteranceAssembler {
  private readonly speakers: Record<SpeakerRole, SpeakerState> = {
    candidate: emptyState(),
    interviewer: emptyState(),
  };

  constructor(private readonly onUtterance: (utterance: Utterance) => void) {}

  push(result: TranscriptResult): void {
    const state = this.speakers[result.role];
    if (!result.isFinal) {
      state.interim = result.text;
      return;
    }

    state.interim = '';
    if (result.text) {
      state.finals.push(result.text);
      state.startSec ??= result.startSec;
      state.endSec = result.endSec;
    }
    if (result.speechFinal || (state.commitOnNextFinal && result.text)) {
      this.commit(result.role, result.receivedAt);
    }
  }

  /** Deepgram's UtteranceEnd: the speaker paused for a full second. */
  endOfUtterance(role: SpeakerRole, at: number): void {
    const state = this.speakers[role];
    if (state.finals.length > 0) this.commit(role, at);
    else if (state.interim) state.commitOnNextFinal = true;
  }

  /** What the speaker has said so far in the current utterance, interim words included. */
  liveText(role: SpeakerRole): string {
    const state = this.speakers[role];
    return [...state.finals, state.interim].filter(Boolean).join(' ');
  }

  /** Commit whatever is final (used when transcription stops). Interim words are dropped. */
  flush(at: number): void {
    ROLES.forEach((role) => {
      if (this.speakers[role].finals.length > 0) this.commit(role, at);
      this.speakers[role] = emptyState();
    });
  }

  private commit(role: SpeakerRole, at: number): void {
    const state = this.speakers[role];
    const text = state.finals.join(' ').trim();
    const utterance: Utterance | null = text
      ? { role, text, startSec: state.startSec ?? state.endSec, endSec: state.endSec, completedAt: at }
      : null;
    this.speakers[role] = { ...emptyState(), interim: state.interim };
    if (utterance) this.onUtterance(utterance);
  }
}
