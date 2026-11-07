/**
 * Phone / in-person mode: one microphone hears both people, and Deepgram's
 * diarization numbers the voices ("speaker 0", "speaker 1"). This decides
 * which number is the candidate, by comparing each voice with a short sample
 * of the candidate's (src/lib/stt/voiceprint.ts):
 * - while the candidate is recording that sample, whoever speaks is them;
 * - otherwise the voice closest to the sample is the candidate when it is
 *   close enough, or clearly closer than the other voice; everyone else is
 *   the interviewer;
 * - with no sample, everyone is the interviewer, so no question is missed.
 *
 * Deepgram numbers voices afresh on every connection, so reset() is called
 * when the transcriber reconnects.
 */

import { VoiceStats, voiceDistance, type Voiceprint } from './voiceprint';

export type SpeakerRole = 'candidate' | 'interviewer';

/** At most this far from the sample (see voiceDistance) is the candidate. */
export const MATCH_DISTANCE = 4.2;
/** Or this much closer to the sample than the other voice. */
const CLEARLY_CLOSER = 1.5;
/** Speech a voice needs before it is compared at all. */
const MIN_SECONDS = 1.2;

type Speaker = { stats: VoiceStats; print: Voiceprint | null; heardInCalibration: boolean };

export class SpeakerResolver {
  private sample: Voiceprint | null = null;
  private calibration: { from: number; to: number | null } | null = null;
  private speakers = new Map<number, Speaker>();

  constructor(private readonly sampleRate = 16000) {}

  hasSample(): boolean {
    return this.sample !== null;
  }

  setSample(sample: Voiceprint | null): void {
    this.sample = sample;
  }

  /** The candidate is recording their sample from `atMs` (wall clock): whoever speaks now is them. */
  startCalibration(atMs: number): void {
    this.calibration = { from: atMs, to: null };
  }

  finishCalibration(atMs: number, sample: Voiceprint | null): void {
    if (this.calibration) this.calibration.to = atMs;
    if (sample) this.sample = sample;
  }

  cancelCalibration(): void {
    this.calibration = null;
  }

  /** A new connection: Deepgram's speaker numbers no longer mean the same people. */
  reset(): void {
    this.speakers.clear();
  }

  /** Mono PCM16 of words Deepgram gave this speaker (final results only, so nothing is counted twice). */
  addSpeech(speaker: number, pcm: Int16Array, atMs: number | null = null): void {
    const entry = this.entry(speaker);
    entry.stats.add(pcm);
    entry.print = entry.stats.print(MIN_SECONDS);
    if (this.inCalibration(atMs)) entry.heardInCalibration = true;
  }

  /**
   * Who this speaker is. `pending` is audio from interim words not added yet,
   * so a new voice can be told apart before its first final result.
   */
  role(speaker: number, { pending, atMs = null }: { pending?: Int16Array; atMs?: number | null } = {}): SpeakerRole {
    if (this.inCalibration(atMs)) return 'candidate';
    const own = this.speakers.get(speaker);
    if (own?.heardInCalibration) return 'candidate';
    for (const [id, other] of this.speakers) {
      if (id !== speaker && other.heardInCalibration) return 'interviewer';
    }
    const sample = this.sample;
    if (!sample) return 'interviewer';

    const prints = new Map<number, Voiceprint>();
    for (const [id, entry] of this.speakers) if (entry.print) prints.set(id, entry.print);
    if (pending) {
      const stats = own ? own.stats.clone() : new VoiceStats(this.sampleRate);
      const print = stats.add(pending).print(MIN_SECONDS);
      if (print) prints.set(speaker, print);
    }
    if (!prints.has(speaker)) return 'interviewer';

    const ranked = [...prints.entries()]
      .map(([id, print]) => ({ id, distance: voiceDistance(print, sample) }))
      .sort((a, b) => a.distance - b.distance);
    if (ranked[0].id !== speaker) return 'interviewer';
    if (ranked[0].distance <= MATCH_DISTANCE) return 'candidate';
    return ranked.length > 1 && ranked[1].distance - ranked[0].distance >= CLEARLY_CLOSER ? 'candidate' : 'interviewer';
  }

  private inCalibration(atMs: number | null): boolean {
    const window = this.calibration;
    if (!window || atMs === null) return false;
    return atMs >= window.from && (window.to === null || atMs <= window.to);
  }

  private entry(speaker: number): Speaker {
    let entry = this.speakers.get(speaker);
    if (!entry) {
      entry = { stats: new VoiceStats(this.sampleRate), print: null, heardInCalibration: false };
      this.speakers.set(speaker, entry);
    }
    return entry;
  }
}
