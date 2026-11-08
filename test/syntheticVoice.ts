/**
 * Synthetic talkers for the voice-sample tests: syllables of harmonics shaped
 * by vowel formants (scaled by the speaker's vocal-tract length), with pauses,
 * pitch movement and a little noise. Deterministic for a given seed.
 */

export const RATE = 16000;

const VOWELS = [
  [730, 1090, 2440],
  [270, 2290, 3010],
  [300, 870, 2240],
  [530, 1840, 2480],
  [570, 840, 2410],
];

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** `band` limits the voice like a phone speaker does. */
export type Voice = { pitchHz: number; tract: number; band?: [number, number] };

export const YOU: Voice = { pitchHz: 120, tract: 1 };
export const THEM: Voice = { pitchHz: 205, tract: 1.17 };
export const ON_THE_PHONE: Voice = { pitchHz: 125, tract: 1.05, band: [300, 3400] };

export function speak(voice: Voice, seconds: number, seed: number, gain = 0.3): Int16Array {
  const random = seeded(seed);
  const out = new Int16Array(Math.round(seconds * RATE));
  let t = 0;
  while (t < out.length) {
    const syllable = Math.round((0.18 + random() * 0.2) * RATE);
    const pause = Math.round((0.03 + random() * 0.15) * RATE);
    const formants = VOWELS[Math.floor(random() * VOWELS.length)].map((f) => f * voice.tract);
    const f0 = voice.pitchHz * (0.92 + random() * 0.16);
    const harmonics: Array<[number, number]> = [];
    for (let k = 1; k * f0 < RATE / 2 - 200; k += 1) {
      const hz = k * f0;
      if (voice.band && (hz < voice.band[0] || hz > voice.band[1])) continue;
      const envelope = formants.reduce((sum, formant, i) => sum + Math.exp(-(((hz - formant) / (90 + 40 * i)) ** 2)) / (i + 1), 0.02);
      harmonics.push([hz, envelope / Math.sqrt(k)]);
    }
    const total = harmonics.reduce((sum, [, amplitude]) => sum + amplitude, 0) || 1;
    for (let i = 0; i < syllable && t + i < out.length; i += 1) {
      const shape = Math.sin((Math.PI * i) / syllable);
      let sample = 0;
      for (const [hz, amplitude] of harmonics) sample += amplitude * Math.sin((2 * Math.PI * hz * (t + i)) / RATE);
      out[t + i] = Math.round(32767 * gain * shape * (sample / total) + (random() - 0.5) * 30);
    }
    t += syllable + pause;
  }
  return out;
}

