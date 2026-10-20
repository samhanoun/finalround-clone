import {
  LiveTranscriber,
  SttTokenError,
  type LiveSttStatus,
  type SttToken,
  type TranscriptResult,
} from '@/lib/stt/deepgramLive';
import type { CaptureFrame } from '@/lib/audio/capture';

const FRAME_SAMPLES = 800; // 50 ms at 16 kHz
const TOKEN: SttToken = { token: 'tmp-token', listenUrl: 'wss://example.test/v1/listen?channels=2' };

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType: BinaryType = 'blob';
  readonly sent: Array<string | ArrayBuffer> = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }

  readonly close = jest.fn((code?: number) => {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1005, reason: '' } as CloseEvent);
  });

  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' } as CloseEvent);
  }

  /** First sample of each audio frame sent; test frames carry their id there. */
  get audioIds() {
    return this.sent.filter((d): d is ArrayBuffer => typeof d !== 'string').map((buffer) => new Int16Array(buffer)[0]);
  }

  get controls() {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d).type as string);
  }
}

function frame(id: number): CaptureFrame {
  const pcm = new Int16Array(FRAME_SAMPLES * 2);
  pcm[0] = id;
  return { pcm, sampleRate: 16000, channels: 2, receivedAt: 0 };
}

function results(channel: number, start: number, duration: number, transcript: string, extra: Record<string, unknown> = {}) {
  const words = (extra.words as unknown[]) ?? [];
  return {
    type: 'Results',
    channel_index: [channel, 2],
    start,
    duration,
    is_final: false,
    speech_final: false,
    channel: { alternatives: [{ transcript, confidence: 0.9, words }] },
    ...extra,
  };
}

async function flush() {
  await jest.advanceTimersByTimeAsync(0);
}

function setup(getToken: () => Promise<SttToken> = async () => TOKEN, options: Record<string, unknown> = {}) {
  const transcriber = new LiveTranscriber({
    getToken,
    random: () => 0,
    createSocket: (url, protocols) => new FakeSocket(url, protocols),
    ...options,
  });
  const statuses: Array<[LiveSttStatus, string | null]> = [];
  const received: TranscriptResult[] = [];
  transcriber.onStatus((status, error) => statuses.push([status, error]));
  transcriber.onResult((result) => received.push(result));
  return { transcriber, statuses, received };
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeSocket.instances = [];
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LiveTranscriber', () => {
  it('opens one socket with the short-lived token and flushes audio captured while connecting', async () => {
    const { transcriber, statuses } = setup();
    transcriber.start();
    transcriber.sendFrame(frame(1));
    transcriber.sendFrame(frame(2));
    await flush();

    const socket = FakeSocket.instances[0];
    expect(socket.url).toBe(TOKEN.listenUrl);
    expect(socket.protocols).toEqual(['bearer', 'tmp-token']);
    expect(socket.binaryType).toBe('arraybuffer');

    socket.open();
    transcriber.sendFrame(frame(3));
    expect(socket.audioIds).toEqual([1, 2, 3]);
    expect(statuses.map(([s]) => s)).toEqual(['connecting', 'live']);
  });

  it('labels results by channel and reports times since capture start', async () => {
    const { transcriber, received } = setup();
    transcriber.start();
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    transcriber.sendFrame(frame(1));

    socket.receive(results(1, 0.1, 0.2, 'tell me about'));
    socket.receive(results(1, 0.1, 0.6, 'Tell me about yourself?', { is_final: true, speech_final: true }));
    socket.receive(results(0, 0, 0.5, 'sure', { is_final: true }));

    expect(received).toEqual([
      expect.objectContaining({ role: 'interviewer', text: 'tell me about', isFinal: false, speechFinal: false }),
      expect.objectContaining({ role: 'interviewer', text: 'Tell me about yourself?', isFinal: true, speechFinal: true }),
      expect.objectContaining({ role: 'candidate', text: 'sure', isFinal: true, speechFinal: false }),
    ]);
    expect(received[1].startSec).toBeCloseTo(0.1, 6);
    expect(received[1].endSec).toBeCloseTo(0.7, 6);
  });

  it('sends Finalize once a speaking channel goes quiet, and marks that channel\'s flushed result as the end of speech', async () => {
    const { transcriber, received } = setup();
    transcriber.start();
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    transcriber.sendFrame(frame(1));

    transcriber.noteLevels({ candidate: 0, interviewer: 0.2 });
    jest.advanceTimersByTime(300);
    transcriber.noteLevels({ candidate: 0, interviewer: 0 });
    expect(socket.controls).not.toContain('Finalize');

    jest.advanceTimersByTime(400);
    transcriber.noteLevels({ candidate: 0, interviewer: 0 });
    transcriber.noteLevels({ candidate: 0, interviewer: 0 });
    expect(socket.controls.filter((type) => type === 'Finalize')).toHaveLength(1);

    socket.receive(results(0, 0, 0.5, 'um', { is_final: true, from_finalize: true }));
    socket.receive(results(1, 0, 0.5, 'Why this role?', { is_final: true, from_finalize: true }));
    expect(received.map((r) => [r.role, r.speechFinal])).toEqual([
      ['candidate', false],
      ['interviewer', true],
    ]);
  });

  it('sends KeepAlive when no audio has gone out for a while', async () => {
    const { transcriber } = setup();
    transcriber.start();
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    transcriber.sendFrame(frame(1));

    jest.advanceTimersByTime(2_000);
    transcriber.sendFrame(frame(2)); // audio at 2 s
    jest.advanceTimersByTime(2_000); // check at 4 s: audio went out 2 s ago
    expect(socket.controls).not.toContain('KeepAlive');
    jest.advanceTimersByTime(4_000); // check at 8 s: nothing for 6 s
    expect(socket.controls).toContain('KeepAlive');
  });

  it('reconnects after a drop, replays only unfinalized audio and drops words already delivered', async () => {
    const getToken = jest.fn(async () => TOKEN);
    const { transcriber, statuses, received } = setup(getToken);
    transcriber.start();
    await flush();
    const first = FakeSocket.instances[0];
    first.open();
    for (let id = 0; id < 20; id++) transcriber.sendFrame(frame(id)); // 0.0–1.0 s

    // Candidate final up to 0.5 s; interviewer final up to 0.4 s (6400 samples).
    first.receive(results(0, 0, 0.5, 'I led the', { is_final: true, words: [{ word: 'led', start: 0.1, end: 0.45 }] }));
    first.receive(results(1, 0, 0.4, '', { is_final: true }));
    received.length = 0;

    first.drop();
    expect(statuses.at(-1)?.[0]).toBe('reconnecting');
    transcriber.sendFrame(frame(20)); // captured during the outage
    transcriber.sendFrame(frame(21));

    await jest.advanceTimersByTimeAsync(250);
    expect(getToken).toHaveBeenCalledTimes(2);
    const second = FakeSocket.instances[1];
    second.open();
    expect(statuses.at(-1)?.[0]).toBe('live');

    // Frames ending after 0.4 s (frame 8 starts at 6400 samples) through the outage.
    expect(second.audioIds).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);

    // Times on the new connection start at frame 8 (0.4 s into the capture).
    second.receive(
      results(0, 0, 0.4, 'the migration', {
        is_final: true,
        words: [
          { word: 'the', punctuated_word: 'the', start: 0.02, end: 0.08 },
          { word: 'migration', punctuated_word: 'migration', start: 0.15, end: 0.35 },
        ],
      }),
    );
    expect(received).toEqual([expect.objectContaining({ role: 'candidate', text: 'migration' })]);
    expect(received[0].startSec).toBeCloseTo(0.4, 6);
  });

  it('drops a repeated word even when the replay overlap is shorter than one frame', async () => {
    const { transcriber, received } = setup();
    transcriber.start();
    await flush();
    const first = FakeSocket.instances[0];
    first.open();
    for (let id = 0; id < 10; id++) transcriber.sendFrame(frame(id));
    first.receive(results(0, 0, 0.5, '', { is_final: true }));
    first.receive(results(1, 0, 0.32, 'Tell me about yourself?', { is_final: true, speech_final: true }));
    received.length = 0;

    first.drop();
    await jest.advanceTimersByTimeAsync(250);
    const second = FakeSocket.instances[1];
    second.open();
    expect(second.audioIds[0]).toBe(6); // frame 6 covers 0.30–0.35 s, the edge is 0.32 s

    second.receive(
      results(1, 0, 0.3, 'yourself? Next', {
        is_final: true,
        words: [
          { word: 'yourself', punctuated_word: 'yourself?', start: 0, end: 0.02 },
          { word: 'next', punctuated_word: 'Next', start: 0.1, end: 0.2 },
        ],
      }),
    );
    second.receive(results(1, 0.3, 0.4, 'question.', { is_final: true, words: [{ word: 'question', start: 0.3, end: 0.6 }] }));
    expect(received.map((r) => r.text)).toEqual(['Next', 'question.']);
  });

  it('stops for good when the server refuses a token', async () => {
    const getToken = jest.fn(async () => {
      throw new SttTokenError('quota', false);
    });
    const { transcriber, statuses } = setup(getToken);
    transcriber.start();
    await flush();
    await jest.advanceTimersByTimeAsync(10_000);

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toEqual(['error', 'quota']);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('keeps retrying while the token request fails because the network is down', async () => {
    let calls = 0;
    const getToken = jest.fn(async () => {
      calls += 1;
      if (calls < 9) throw new SttTokenError('offline', true);
      return TOKEN;
    });
    const { transcriber } = setup(getToken);
    transcriber.start();
    await flush();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(getToken).toHaveBeenCalledTimes(9);
    expect(transcriber.getStatus()).toBe('connecting');
    FakeSocket.instances[0].open();
    expect(transcriber.getStatus()).toBe('live');
  });

  it('gives up after Deepgram refuses the socket several times in a row', async () => {
    const getToken = jest.fn(async () => TOKEN);
    const { transcriber, statuses } = setup(getToken, { maxRejectedConnects: 3 });
    transcriber.start();
    for (let attempt = 0; attempt < 3; attempt++) {
      await flush();
      FakeSocket.instances[attempt].drop(1006);
      await jest.advanceTimersByTimeAsync(10_000);
    }

    expect(getToken).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)?.[0]).toBe('error');
  });

  it('asks Deepgram to flush on stop, delivers the last results, then closes', async () => {
    const { transcriber, received, statuses } = setup();
    transcriber.start();
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    transcriber.sendFrame(frame(1));

    let stopped = false;
    void transcriber.stop().then(() => {
      stopped = true;
    });
    expect(socket.controls).toEqual(['CloseStream']);
    transcriber.sendFrame(frame(2));
    expect(socket.audioIds).toEqual([1]);

    socket.receive(results(1, 0, 0.5, 'Thanks for your time.', { is_final: true, speech_final: true }));
    expect(received.map((r) => r.text)).toEqual(['Thanks for your time.']);

    socket.drop(1000);
    await flush();
    expect(stopped).toBe(true);
    expect(statuses.at(-1)?.[0]).toBe('closed');
  });

  it('force-closes if Deepgram never closes after CloseStream', async () => {
    const { transcriber } = setup();
    transcriber.start();
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    const done = transcriber.stop();
    jest.advanceTimersByTime(2_000);
    await done;
    expect(socket.close).toHaveBeenCalledWith(1000);
    expect(transcriber.getStatus()).toBe('closed');
  });
});
