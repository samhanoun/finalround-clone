import { hasSignal, levelToPercent, rmsToDb } from '@/lib/audio/levels';

describe('audio levels', () => {
  it('converts RMS to dBFS', () => {
    expect(rmsToDb(1)).toBeCloseTo(0, 6);
    expect(rmsToDb(0.1)).toBeCloseTo(-20, 6);
  });

  it('maps -60..0 dBFS onto 0..100%', () => {
    expect(levelToPercent(0)).toBe(0);
    expect(levelToPercent(0.001)).toBeCloseTo(0, 6); // -60 dB
    expect(levelToPercent(Math.pow(10, -30 / 20))).toBeCloseTo(50, 6); // -30 dB
    expect(levelToPercent(1)).toBe(100);
    expect(levelToPercent(4)).toBe(100);
  });

  it('flags speech-level audio but not background noise', () => {
    expect(hasSignal(Math.pow(10, -30 / 20))).toBe(true);
    expect(hasSignal(Math.pow(10, -55 / 20))).toBe(false);
  });
});
