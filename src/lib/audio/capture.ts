/**
 * Dual-source audio capture for the live copilot (browser only).
 *
 * Channel 0 is the candidate's microphone. Channel 1 is the meeting audio the
 * user shares with getDisplayMedia: the meeting tab with "Share tab audio", or
 * on Windows the entire screen with "Share system audio". Speaker roles come
 * from the channel, so no diarization is needed.
 */

export type CaptureSource = 'candidate' | 'interviewer';

export type CaptureErrorCode = 'unsupported' | 'share-cancelled' | 'no-share-audio' | 'mic-denied' | 'audio-engine';

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;

  constructor(code: CaptureErrorCode, message: string) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
  }
}

export interface CaptureFrame {
  /** Interleaved 16-bit PCM: [candidate, interviewer, candidate, interviewer, ...]. */
  pcm: Int16Array;
  sampleRate: number;
  channels: 2;
  /** Main-thread arrival time (ms since epoch). */
  receivedAt: number;
}

/** Per-channel RMS (0..1) of the latest frame. */
export interface CaptureLevels {
  candidate: number;
  interviewer: number;
}

type WorkletFrameMessage = {
  type: 'frame';
  pcm: ArrayBuffer;
  levels: [number, number];
  sampleRate: number;
  channels: 2;
};

type DisplayMediaOptions = DisplayMediaStreamOptions & {
  systemAudio?: 'include' | 'exclude';
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
};

const WORKLET_URL = '/worklets/pcm16-capture-worklet.js';
const WORKLET_NAME = 'pcm16-capture';
export const TARGET_SAMPLE_RATE = 16000;
const DEFAULT_FRAME_MS = 50;

const DISPLAY_OPTIONS: DisplayMediaOptions = {
  // The video track is kept (at a low frame rate) for screen-reading features.
  video: { frameRate: { ideal: 5, max: 15 } },
  // Raw meeting audio: the browser's voice processing would distort the interviewer.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  systemAudio: 'include',
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
};

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  // Cancels interviewer audio that leaks from speakers into the mic.
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function createAudioContext(): AudioContext {
  try {
    // Chromium resamples the 48 kHz sources to 16 kHz itself, with proper filtering.
    return new AudioContext({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' });
  } catch {
    // Otherwise run at the device rate and let the worklet downsample.
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

export class DualAudioCapture {
  private readonly frameMs: number;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private mic: MediaStream | null = null;
  private display: MediaStream | null = null;
  private readonly frameListeners = new Set<(frame: CaptureFrame) => void>();
  private readonly levelListeners = new Set<(levels: CaptureLevels) => void>();
  private readonly endedListeners = new Set<(source: CaptureSource) => void>();

  private readonly testMicAsInterviewer: boolean;

  /**
   * `testMicAsInterviewer` is for end-to-end tests only: the (fake) microphone
   * plays the interviewer, no screen is shared, and the candidate channel stays
   * silent. Chromium's --use-file-for-fake-audio-capture feeds that microphone.
   */
  constructor(options: { frameMs?: number; testMicAsInterviewer?: boolean } = {}) {
    this.frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
    this.testMicAsInterviewer = options.testMicAsInterviewer ?? false;
  }

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof AudioWorkletNode !== 'undefined'
    );
  }

  /**
   * Must be called from a click handler: getDisplayMedia needs the click's user
   * activation, so it is requested before anything else is awaited.
   */
  async start(): Promise<void> {
    if (this.context) return;
    if (!DualAudioCapture.isSupported()) {
      throw new CaptureError('unsupported', 'This browser cannot capture meeting audio. Use Chrome or Edge on a desktop computer.');
    }
    if (this.testMicAsInterviewer) {
      await this.startTestMode();
      return;
    }

    try {
      this.display = await navigator.mediaDevices.getDisplayMedia(DISPLAY_OPTIONS);
    } catch {
      throw new CaptureError('share-cancelled', 'Sharing was cancelled. Pick the tab with your interview and tick "Share tab audio".');
    }

    const [meetingTrack] = this.display.getAudioTracks();
    if (!meetingTrack) {
      this.stop();
      throw new CaptureError(
        'no-share-audio',
        'No audio was shared. Pick the tab with your interview and tick "Share tab audio" (on Windows you can also share the entire screen with "Share system audio").',
      );
    }

    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    } catch {
      this.stop();
      throw new CaptureError('mic-denied', 'Microphone access was blocked. Allow the microphone for this site, then start again.');
    }

    try {
      await this.buildGraph(this.mic, meetingTrack);
    } catch (error) {
      this.stop();
      const detail = error instanceof Error ? error.message : String(error);
      throw new CaptureError('audio-engine', `Could not start audio processing: ${detail}`);
    }

    meetingTrack.addEventListener('ended', () => this.emitEnded('interviewer'));
    this.mic.getAudioTracks()[0]?.addEventListener('ended', () => this.emitEnded('candidate'));
  }

  stop(): void {
    this.node?.port.postMessage({ type: 'stop' });
    this.node?.disconnect();
    this.node = null;
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
    stopTracks(this.mic);
    stopTracks(this.display);
    this.mic = null;
    this.display = null;
  }

  /** The shared screen/tab video, for features that read the screen. */
  getDisplayVideoTrack(): MediaStreamTrack | null {
    return this.display?.getVideoTracks()[0] ?? null;
  }

  onFrame(listener: (frame: CaptureFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onLevels(listener: (levels: CaptureLevels) => void): () => void {
    this.levelListeners.add(listener);
    return () => {
      this.levelListeners.delete(listener);
    };
  }

  /** Fires when the user stops sharing or the microphone disappears. */
  onEnded(listener: (source: CaptureSource) => void): () => void {
    this.endedListeners.add(listener);
    return () => {
      this.endedListeners.delete(listener);
    };
  }

  private async startTestMode() {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      throw new CaptureError('mic-denied', 'Microphone access was blocked.');
    }
    const [track] = this.mic.getAudioTracks();
    try {
      await this.buildGraph(null, track);
    } catch (error) {
      this.stop();
      throw new CaptureError('audio-engine', `Could not start audio processing: ${error instanceof Error ? error.message : String(error)}`);
    }
    track.addEventListener('ended', () => this.emitEnded('interviewer'));
  }

  /** A null mic leaves the candidate channel silent (test mode). */
  private async buildGraph(mic: MediaStream | null, meetingTrack: MediaStreamTrack) {
    const context = createAudioContext();
    this.context = context;
    await context.audioWorklet.addModule(WORKLET_URL);

    // Merger inputs are mono, so a stereo meeting tab is downmixed automatically.
    const merger = context.createChannelMerger(2);
    if (mic) context.createMediaStreamSource(mic).connect(merger, 0, 0);
    context.createMediaStreamSource(new MediaStream([meetingTrack])).connect(merger, 0, 1);

    const node = new AudioWorkletNode(context, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE, frameMs: this.frameMs },
    });
    node.port.onmessage = (event: MessageEvent<WorkletFrameMessage>) => this.handleWorkletMessage(event.data);
    this.node = node;

    // Keep the graph pulled without playing the meeting audio back a second time.
    const sink = context.createGain();
    sink.gain.value = 0;
    merger.connect(node);
    node.connect(sink);
    sink.connect(context.destination);

    if (context.state === 'suspended') await context.resume();
  }

  private handleWorkletMessage(message: WorkletFrameMessage) {
    if (message?.type !== 'frame') return;
    const frame: CaptureFrame = {
      pcm: new Int16Array(message.pcm),
      sampleRate: message.sampleRate,
      channels: 2,
      receivedAt: Date.now(),
    };
    const levels: CaptureLevels = { candidate: message.levels[0], interviewer: message.levels[1] };
    this.frameListeners.forEach((listener) => listener(frame));
    this.levelListeners.forEach((listener) => listener(levels));
  }

  private emitEnded(source: CaptureSource) {
    this.endedListeners.forEach((listener) => listener(source));
  }
}
