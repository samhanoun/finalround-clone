import { MATCH_DISTANCE } from '@/lib/stt/speakers';
import { VoiceStats, parseVoiceprint, voiceDistance, voiceprint } from '@/lib/stt/voiceprint';
import { ON_THE_PHONE, RATE, THEM, YOU, speak } from '../../../test/syntheticVoice';

describe('voiceprint', () => {
  it('needs a little speech before it gives a print', () => {
    expect(voiceprint(new Int16Array(RATE * 2))).toBeNull(); // silence
    expect(voiceprint(speak(YOU, 0.3, 1))).toBeNull();
    const print = voiceprint(speak(YOU, 4, 1));
    expect(print?.shape).toHaveLength(16);
    expect(print?.pitchHz).toBeGreaterThan(100);
    expect(print?.pitchHz).toBeLessThan(140);
  });

  it('finds the same person closer than someone else', () => {
    const sample = voiceprint(speak(YOU, 8, 1))!;
    for (const seed of [2, 5, 9]) {
      const self = voiceDistance(sample, voiceprint(speak(YOU, 3, seed))!);
      expect(self).toBeLessThan(MATCH_DISTANCE);
      expect(voiceDistance(sample, voiceprint(speak(THEM, 3, seed + 100))!)).toBeGreaterThan(MATCH_DISTANCE + 0.5);
      // Similar pitch, but the phone speaker's narrow band gives it away.
      expect(voiceDistance(sample, voiceprint(speak(ON_THE_PHONE, 3, seed + 200))!)).toBeGreaterThan(MATCH_DISTANCE + 0.5);
    }
  });

  it('ignores how loud the voice is', () => {
    const sample = voiceprint(speak(YOU, 4, 1, 0.3))!;
    const quiet = voiceprint(speak(YOU, 4, 1, 0.08))!;
    expect(voiceDistance(sample, quiet)).toBeLessThan(1);
    expect(quiet.levelDb).toBeLessThan(sample.levelDb - 6);
  });

  it('adds audio in pieces the same as all at once', () => {
    const audio = speak(YOU, 3, 5);
    const whole = new VoiceStats().add(audio).print()!;
    const pieces = new VoiceStats().add(audio.subarray(0, 24_000)).add(audio.subarray(24_000)).print()!;
    expect(voiceDistance(whole, pieces)).toBeLessThan(0.5);
  });

  it('reads back only well-formed stored prints', () => {
    const print = voiceprint(speak(YOU, 3, 6))!;
    expect(parseVoiceprint(JSON.parse(JSON.stringify(print)))).toEqual(print);
    expect(parseVoiceprint({ ...print, shape: [1, 2] })).toBeNull();
    expect(parseVoiceprint('nope')).toBeNull();
  });
});
