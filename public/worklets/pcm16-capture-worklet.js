/**
 * Live-copilot capture worklet.
 *
 * Input: one 2-channel input (channel 0 = candidate mic, channel 1 = meeting
 * audio). Output to the main thread, every `frameMs`:
 *   { type: 'frame', pcm: ArrayBuffer (Int16, interleaved [c0, c1, c0, c1, ...]),
 *     levels: [rms0, rms1], sampleRate, channels: 2 }
 *
 * Loaded with audioWorklet.addModule(); the helpers are also exported for Jest.
 */

const CHANNELS = 2;

function floatToInt16(sample) {
  const s = Math.max(-1, Math.min(1, sample));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

/**
 * Downsamples both channels on one shared clock so they stay sample-aligned.
 * Each output sample is the mean of the input samples it covers (a box filter),
 * which removes most content above the new Nyquist rate - adequate for speech.
 * When inputRate <= outputRate the samples pass through unchanged.
 */
function createStereoResampler(inputRate, outputRate) {
  const step = inputRate > outputRate ? inputRate / outputRate : 1;
  let filled = 0;
  let count = 0;
  let sum0 = 0;
  let sum1 = 0;

  return function push(ch0, ch1, length, emit) {
    for (let i = 0; i < length; i++) {
      sum0 += ch0 ? ch0[i] : 0;
      sum1 += ch1 ? ch1[i] : 0;
      count++;
      filled++;
      if (filled >= step) {
        emit(sum0 / count, sum1 / count);
        filled -= step;
        sum0 = 0;
        sum1 = 0;
        count = 0;
      }
    }
  };
}

/** Packs samples into fixed-size interleaved Int16 frames with per-channel RMS. */
function createFramer(frameSamples, onFrame) {
  let pcm = new Int16Array(frameSamples * CHANNELS);
  let index = 0;
  let squares0 = 0;
  let squares1 = 0;

  return function write(s0, s1) {
    pcm[index * CHANNELS] = floatToInt16(s0);
    pcm[index * CHANNELS + 1] = floatToInt16(s1);
    squares0 += s0 * s0;
    squares1 += s1 * s1;
    index++;
    if (index === frameSamples) {
      onFrame(pcm, [Math.sqrt(squares0 / frameSamples), Math.sqrt(squares1 / frameSamples)]);
      // The previous buffer is transferred to the main thread, so start a new one.
      pcm = new Int16Array(frameSamples * CHANNELS);
      index = 0;
      squares0 = 0;
      squares1 = 0;
    }
  };
}

if (typeof AudioWorkletProcessor === 'function' && typeof registerProcessor === 'function') {
  class Pcm16CaptureProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const opts = (options && options.processorOptions) || {};
      const targetRate = opts.targetSampleRate || 16000;
      const outputRate = sampleRate > targetRate ? targetRate : sampleRate;
      const frameSamples = Math.round((outputRate * (opts.frameMs || 50)) / 1000);

      this.running = true;
      this.resample = createStereoResampler(sampleRate, outputRate);
      this.write = createFramer(frameSamples, (pcm, levels) => {
        this.port.postMessage(
          { type: 'frame', pcm: pcm.buffer, levels, sampleRate: outputRate, channels: CHANNELS },
          [pcm.buffer],
        );
      });
      this.port.onmessage = (event) => {
        if (event.data && event.data.type === 'stop') this.running = false;
      };
    }

    process(inputs) {
      const input = inputs[0];
      if (input && input.length > 0) {
        this.resample(input[0], input[1], input[0].length, this.write);
      }
      return this.running;
    }
  }

  registerProcessor('pcm16-capture', Pcm16CaptureProcessor);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHANNELS, floatToInt16, createStereoResampler, createFramer };
}
