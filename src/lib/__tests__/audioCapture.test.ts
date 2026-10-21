import { CaptureError, DualAudioCapture, type CaptureFrame, type CaptureLevels } from '@/lib/audio/capture';

class FakeTrack extends EventTarget {
  readonly stop = jest.fn();
  constructor(readonly kind: 'audio' | 'video') {
    super();
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

class FakeNode {
  readonly connect = jest.fn();
  readonly disconnect = jest.fn();
}

class FakeWorkletNode extends FakeNode {
  static last: FakeWorkletNode | null = null;
  readonly port = { postMessage: jest.fn(), onmessage: null as ((event: { data: unknown }) => void) | null };
  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: { processorOptions: { targetSampleRate: number; frameMs: number } },
  ) {
    super();
    FakeWorkletNode.last = this;
  }
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  state = 'suspended';
  readonly destination = {};
  readonly audioWorklet = { addModule: jest.fn().mockResolvedValue(undefined) };
  readonly resume = jest.fn(async () => {
    this.state = 'running';
  });
  readonly close = jest.fn().mockResolvedValue(undefined);
  readonly sources: unknown[] = [];
  constructor(readonly options: unknown) {
    FakeAudioContext.last = this;
  }
  createChannelMerger() {
    return new FakeNode();
  }
  createMediaStreamSource(stream: unknown) {
    this.sources.push(stream);
    return new FakeNode();
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: { value: 1 } });
  }
}

const calls: string[] = [];
let displayStream: FakeStream;
let micStream: FakeStream;
let getDisplayMedia: jest.Mock;
let getUserMedia: jest.Mock;

beforeEach(() => {
  calls.length = 0;
  displayStream = new FakeStream([new FakeTrack('video'), new FakeTrack('audio')]);
  micStream = new FakeStream([new FakeTrack('audio')]);
  getDisplayMedia = jest.fn(async () => {
    calls.push('display');
    return displayStream;
  });
  getUserMedia = jest.fn(async () => {
    calls.push('mic');
    return micStream;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia, getUserMedia },
  });
  Object.assign(globalThis, {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeWorkletNode,
    MediaStream: class {
      constructor(readonly tracks: unknown[]) {}
    },
  });
});

async function expectCaptureError(promise: Promise<void>, code: CaptureError['code']) {
  await expect(promise).rejects.toBeInstanceOf(CaptureError);
  await promise.catch((error: CaptureError) => expect(error.code).toBe(code));
}

describe('DualAudioCapture', () => {
  it('asks for the screen share before the microphone and builds a 16 kHz graph', async () => {
    const capture = new DualAudioCapture();
    await capture.start();

    expect(calls).toEqual(['display', 'mic']);
    expect(FakeAudioContext.last?.options).toMatchObject({ sampleRate: 16000 });
    expect(FakeAudioContext.last?.audioWorklet.addModule).toHaveBeenCalledWith('/worklets/pcm16-capture-worklet.js');
    expect(FakeWorkletNode.last?.name).toBe('pcm16-capture');
    expect(FakeWorkletNode.last?.options.processorOptions).toEqual({ targetSampleRate: 16000, frameMs: 50 });
    expect(FakeAudioContext.last?.resume).toHaveBeenCalled();
    expect(capture.getDisplayVideoTrack()).toBe(displayStream.getVideoTracks()[0]);
  });

  it('rejects a share without audio and releases the shared screen', async () => {
    displayStream = new FakeStream([new FakeTrack('video')]);
    await expectCaptureError(new DualAudioCapture().start(), 'no-share-audio');
    expect(displayStream.getVideoTracks()[0].stop).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('reports a cancelled share prompt', async () => {
    getDisplayMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expectCaptureError(new DualAudioCapture().start(), 'share-cancelled');
  });

  it('stops the shared tab when the microphone is denied', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expectCaptureError(new DualAudioCapture().start(), 'mic-denied');
    displayStream.getTracks().forEach((track) => expect(track.stop).toHaveBeenCalled());
  });

  it('reports unsupported browsers before prompting', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    await expectCaptureError(new DualAudioCapture().start(), 'unsupported');
  });

  it('delivers worklet frames and per-source levels', async () => {
    const capture = new DualAudioCapture();
    const frames: CaptureFrame[] = [];
    const levels: CaptureLevels[] = [];
    capture.onFrame((frame) => frames.push(frame));
    capture.onLevels((value) => levels.push(value));
    await capture.start();

    const pcm = Int16Array.from([1, 2, 3, 4]);
    FakeWorkletNode.last?.port.onmessage?.({
      data: { type: 'frame', pcm: pcm.buffer, levels: [0.2, 0.4], sampleRate: 16000, channels: 2 },
    });

    expect(Array.from(frames[0].pcm)).toEqual([1, 2, 3, 4]);
    expect(frames[0].sampleRate).toBe(16000);
    expect(levels).toEqual([{ candidate: 0.2, interviewer: 0.4 }]);
  });

  it('signals when the user stops sharing, and stop() releases everything', async () => {
    const capture = new DualAudioCapture();
    const ended: string[] = [];
    capture.onEnded((source) => ended.push(source));
    await capture.start();

    displayStream.getAudioTracks()[0].dispatchEvent(new Event('ended'));
    expect(ended).toEqual(['interviewer']);

    const context = FakeAudioContext.last;
    capture.stop();
    expect(context?.close).toHaveBeenCalled();
    [...displayStream.getTracks(), ...micStream.getTracks()].forEach((track) => expect(track.stop).toHaveBeenCalled());
  });

  it('end-to-end test mode: the (fake) mic plays the interviewer and the (fake) camera stands in for the screen', async () => {
    const cameraStream = new FakeStream([new FakeTrack('video')]);
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      calls.push(constraints.video ? 'camera' : 'mic');
      return constraints.video ? cameraStream : micStream;
    });
    const capture = new DualAudioCapture({ testMicAsInterviewer: true });
    const ended: string[] = [];
    capture.onEnded((source) => ended.push(source));
    await capture.start();

    expect(calls).toEqual(['mic', 'camera']);
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(capture.getDisplayVideoTrack()).toBe(cameraStream.getVideoTracks()[0]);
    // Only the interviewer channel gets a source; the candidate channel stays silent.
    expect(FakeAudioContext.last?.sources).toHaveLength(1);
    micStream.getAudioTracks()[0].dispatchEvent(new Event('ended'));
    expect(ended).toEqual(['interviewer']);
    capture.stop();
  });
});
