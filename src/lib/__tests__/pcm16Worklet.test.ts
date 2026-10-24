// The worklet is plain JS served from /public; it exports its helpers when require()d.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const worklet = require('../../../public/worklets/pcm16-capture-worklet.js') as {
  CHANNELS: number;
  floatToInt16: (sample: number) => number;
  createStereoResampler: (
    inputRate: number,
    outputRate: number,
  ) => (ch0: Float32Array | undefined, ch1: Float32Array | undefined, length: number, emit: (s0: number, s1: number) => void) => void;
  createFramer: (frameSamples: number, onFrame: (pcm: Int16Array, levels: [number, number]) => void) => (s0: number, s1: number) => void;
};

function collect(inputRate: number, outputRate: number, ch0: Float32Array, ch1?: Float32Array) {
  const out: Array<[number, number]> = [];
  worklet.createStereoResampler(inputRate, outputRate)(ch0, ch1, ch0.length, (a, b) => out.push([a, b]));
  return out;
}

describe('pcm16 capture worklet', () => {
  it('converts floats to clamped 16-bit PCM', () => {
    expect(worklet.floatToInt16(0)).toBe(0);
    expect(worklet.floatToInt16(1)).toBe(32767);
    expect(worklet.floatToInt16(-1)).toBe(-32768);
    expect(worklet.floatToInt16(2)).toBe(32767);
    expect(worklet.floatToInt16(-3)).toBe(-32768);
  });

  it('passes samples through when the context already runs at 16 kHz', () => {
    const input = Float32Array.from([0.1, -0.2, 0.3]);
    expect(collect(16000, 16000, input, input).map(([a]) => a)).toEqual([0.1, -0.2, 0.3].map(Math.fround));
  });

  it('downsamples 48 kHz to 16 kHz by averaging, keeping channels independent', () => {
    const ch0 = Float32Array.from({ length: 48 }, (_, i) => (i % 3 === 0 ? 0.3 : 0.6));
    const out = collect(48000, 16000, ch0, new Float32Array(48));
    expect(out).toHaveLength(16);
    out.forEach(([a, b]) => {
      expect(a).toBeCloseTo(0.5, 6);
      expect(b).toBe(0);
    });
  });

  it('keeps the long-run output rate right for non-integer ratios (44.1 kHz)', () => {
    const out = collect(44100, 16000, new Float32Array(44100));
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(1);
  });

  it('treats a missing interviewer channel as silence', () => {
    const out = collect(16000, 16000, Float32Array.from([0.5, 0.5]));
    expect(out).toEqual([
      [0.5, 0],
      [0.5, 0],
    ]);
  });

  it('packs interleaved frames and reports per-channel RMS', () => {
    const frames: Array<{ pcm: Int16Array; levels: [number, number] }> = [];
    const write = worklet.createFramer(4, (pcm, levels) => frames.push({ pcm, levels }));
    for (let i = 0; i < 6; i++) write(0.5, -0.25);

    expect(frames).toHaveLength(1);
    expect(frames[0].pcm).toHaveLength(4 * worklet.CHANNELS);
    expect(Array.from(frames[0].pcm.slice(0, 4))).toEqual([
      worklet.floatToInt16(0.5),
      worklet.floatToInt16(-0.25),
      worklet.floatToInt16(0.5),
      worklet.floatToInt16(-0.25),
    ]);
    expect(frames[0].levels[0]).toBeCloseTo(0.5, 6);
    expect(frames[0].levels[1]).toBeCloseTo(0.25, 6);
  });

  it('starts a fresh buffer for each frame because buffers are transferred', () => {
    const buffers: Int16Array[] = [];
    const write = worklet.createFramer(2, (pcm) => buffers.push(pcm));
    for (let i = 0; i < 4; i++) write(0.1, 0.1);
    expect(buffers).toHaveLength(2);
    expect(buffers[0]).not.toBe(buffers[1]);
  });
});
