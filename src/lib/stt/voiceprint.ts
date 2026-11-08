/**
 * A small voice fingerprint, for phone / in-person mode where one microphone
 * hears both people. Deepgram's diarization says "speaker 0" and "speaker 1";
 * comparing each speaker's voice with a short sample of the candidate's says
 * which of them is "you".
 *
 * The print is the long-term average spectrum shape (log energy in mel bands,
 * with each frame's loudness removed so distance from the microphone and gain
 * matter less) plus the median pitch. That separates two people in a room,
 * and a voice coming through a phone speaker (which has nothing below ~300 Hz
 * or above ~3.4 kHz) from one speaking straight into the microphone.
 *
 * Only these numbers are kept, never the audio.
 */

const FRAME = 512;
const HOP = 256;
const BANDS = 16;
/** Below this is mostly the pitch itself, which is compared separately. */
const MIN_HZ = 250;
const MAX_HZ = 7600;
/** A frame quieter than this (RMS, 0–1) is never speech. */
const VOICE_RMS = 0.008;
/** Bands are floored this far below the frame's loudest band, so deep gaps between harmonics don't swing the average. */
const BAND_FLOOR_DB = 45;
/** Frames this far below the loudest in a chunk are pauses or breath. */
const RELATIVE_FLOOR = 0.2;
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 400;
/** Seconds of speech a print needs before it is trusted. */
export const MIN_SPEECH_SECONDS = 0.6;
/** How much a semitone of pitch difference counts, in dB of spectrum difference. */
const PITCH_DB_PER_SEMITONE = 0.35;

export type Voiceprint = {
  /** Average log energy per mel band (dB), each frame's mean removed. */
  shape: number[];
  /** Median pitch in Hz, or null when no steady voicing was found. */
  pitchHz: number | null;
  /** Mean speech level in dB below full scale. */
  levelDb: number;
  /** Seconds of speech the print was built from. */
  seconds: number;
};

type Filter = { from: number; weights: number[] };

const filterCache = new Map<number, Filter[]>();

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

/** Triangular mel filters over the FFT bins. */
function melFilters(sampleRate: number): Filter[] {
  const cached = filterCache.get(sampleRate);
  if (cached) return cached;
  const top = Math.min(MAX_HZ, sampleRate / 2 - 100);
  const low = hzToMel(MIN_HZ);
  const high = hzToMel(top);
  const edges = Array.from({ length: BANDS + 2 }, (_, i) => melToHz(low + ((high - low) * i) / (BANDS + 1)));
  const binHz = sampleRate / FRAME;
  const filters: Filter[] = [];
  for (let band = 0; band < BANDS; band += 1) {
    const [left, center, right] = [edges[band], edges[band + 1], edges[band + 2]];
    const from = Math.max(1, Math.floor(left / binHz));
    const to = Math.min(FRAME / 2, Math.ceil(right / binHz));
    const weights: number[] = [];
    for (let bin = from; bin <= to; bin += 1) {
      const hz = bin * binHz;
      weights.push(hz <= center ? Math.max(0, (hz - left) / (center - left)) : Math.max(0, (right - hz) / (right - center)));
    }
    filters.push({ from, weights });
  }
  filterCache.set(sampleRate, filters);
  return filters;
}

const hann = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size;
    const stepRe = Math.cos(angle);
    const stepIm = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const tRe = re[b] * wRe - im[b] * wIm;
        const tIm = re[b] * wIm + im[b] * wRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const next = wRe * stepRe - wIm * stepIm;
        wIm = wRe * stepIm + wIm * stepRe;
        wRe = next;
      }
    }
  }
}

/** Pitch of one frame by normalized autocorrelation, or null when it isn't steadily voiced. */
function framePitch(frame: Float64Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / MAX_PITCH_HZ);
  const maxLag = Math.min(frame.length - 32, Math.ceil(sampleRate / MIN_PITCH_HZ));
  const scores = new Float64Array(maxLag + 1);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let cross = 0;
    let head = 0;
    let tail = 0;
    for (let i = 0; i + lag < frame.length; i += 1) {
      cross += frame[i] * frame[i + lag];
      head += frame[i] * frame[i];
      tail += frame[i + lag] * frame[i + lag];
    }
    const score = head > 0 && tail > 0 ? cross / Math.sqrt(head * tail) : 0;
    scores[lag] = score;
    if (score > best) best = score;
  }
  if (best < 0.6) return null;
  // The shortest lag close to the best one: longer lags repeat it at half the pitch.
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (scores[lag] >= 0.9 * best && scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) {
      return sampleRate / lag;
    }
  }
  return null;
}

/** Running statistics for one voice; audio goes in once, the print comes out any time. */
export class VoiceStats {
  private readonly sum = new Float64Array(BANDS);
  private frames = 0;
  private levelSum = 0;
  private pitches: number[] = [];

  constructor(private readonly sampleRate = 16000) {}

  /** Mono PCM16 of this voice's speech. */
  add(pcm: Int16Array): this {
    const count = Math.floor((pcm.length - FRAME) / HOP) + 1;
    if (count <= 0) return this;
    const rms = new Float64Array(count);
    let loudest = 0;
    for (let f = 0; f < count; f += 1) {
      let energy = 0;
      for (let i = 0; i < FRAME; i += 1) {
        const x = pcm[f * HOP + i] / 32768;
        energy += x * x;
      }
      rms[f] = Math.sqrt(energy / FRAME);
      loudest = Math.max(loudest, rms[f]);
    }
    const floor = Math.max(VOICE_RMS, loudest * RELATIVE_FLOOR);
    const filters = melFilters(this.sampleRate);
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    const raw = new Float64Array(FRAME);
    const bands = new Float64Array(BANDS);
    let voiced = 0;
    for (let f = 0; f < count; f += 1) {
      if (rms[f] < floor) continue;
      for (let i = 0; i < FRAME; i += 1) {
        raw[i] = pcm[f * HOP + i] / 32768;
        re[i] = raw[i] * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      let peak = -Infinity;
      filters.forEach((filter, band) => {
        let energy = 1e-12;
        filter.weights.forEach((weight, k) => {
          const bin = filter.from + k;
          energy += weight * (re[bin] * re[bin] + im[bin] * im[bin]);
        });
        bands[band] = 10 * Math.log10(energy);
        peak = Math.max(peak, bands[band]);
      });
      let mean = 0;
      for (let band = 0; band < BANDS; band += 1) {
        bands[band] = Math.max(bands[band], peak - BAND_FLOOR_DB);
        mean += bands[band];
      }
      mean /= BANDS;
      for (let band = 0; band < BANDS; band += 1) this.sum[band] += bands[band] - mean;
      this.levelSum += 20 * Math.log10(rms[f]);
      this.frames += 1;
      // Every third voiced frame is plenty for a median pitch.
      if (voiced % 3 === 0) {
        const pitch = framePitch(raw, this.sampleRate);
        if (pitch !== null) this.pitches.push(pitch);
      }
      voiced += 1;
    }
    return this;
  }

  clone(): VoiceStats {
    const copy = new VoiceStats(this.sampleRate);
    copy.sum.set(this.sum);
    copy.frames = this.frames;
    copy.levelSum = this.levelSum;
    copy.pitches = [...this.pitches];
    return copy;
  }

  get seconds(): number {
    return (this.frames * HOP) / this.sampleRate;
  }

  print(minSeconds = MIN_SPEECH_SECONDS): Voiceprint | null {
    if (this.frames === 0 || this.seconds < minSeconds) return null;
    const sorted = [...this.pitches].sort((a, b) => a - b);
    // A handful of pitched frames isn't a reliable pitch.
    const pitchHz = sorted.length >= 5 ? sorted[Math.floor(sorted.length / 2)] : null;
    return {
      shape: Array.from(this.sum, (value) => value / this.frames),
      pitchHz,
      levelDb: this.levelSum / this.frames,
      seconds: this.seconds,
    };
  }
}

export function voiceprint(pcm: Int16Array, sampleRate = 16000): Voiceprint | null {
  return new VoiceStats(sampleRate).add(pcm).print();
}

/** Neighbouring bands are blended before comparing: which vowels were said moves single bands, a different voice moves whole regions. */
const SMOOTHING = [1, 2, 3, 2, 1];

/** How different two voices sound, in dB-like units: about 0–3.5 for the same person, more for someone else. */
export function voiceDistance(a: Voiceprint, b: Voiceprint): number {
  const bands = Math.min(a.shape.length, b.shape.length);
  const difference = Array.from({ length: bands }, (_, band) => a.shape[band] - b.shape[band]);
  const reach = (SMOOTHING.length - 1) / 2;
  let squares = 0;
  for (let band = 0; band < bands; band += 1) {
    let sum = 0;
    let weight = 0;
    SMOOTHING.forEach((w, offset) => {
      const other = band + offset - reach;
      if (other < 0 || other >= bands) return;
      sum += w * difference[other];
      weight += w;
    });
    squares += (sum / weight) ** 2;
  }
  const spectral = Math.sqrt(squares / Math.max(1, bands));
  const pitch =
    a.pitchHz && b.pitchHz ? Math.abs(12 * Math.log2(a.pitchHz / b.pitchHz)) * PITCH_DB_PER_SEMITONE : 0;
  return spectral + pitch;
}

/** A print read back from storage, or null if it isn't one. */
export function parseVoiceprint(value: unknown): Voiceprint | null {
  if (!value || typeof value !== 'object') return null;
  const print = value as Partial<Voiceprint>;
  if (!Array.isArray(print.shape) || print.shape.length !== BANDS || !print.shape.every((n) => Number.isFinite(n))) return null;
  if (print.pitchHz !== null && !(typeof print.pitchHz === 'number' && print.pitchHz > 0)) return null;
  if (typeof print.levelDb !== 'number' || typeof print.seconds !== 'number') return null;
  return { shape: print.shape, pitchHz: print.pitchHz, levelDb: print.levelDb, seconds: print.seconds };
}
