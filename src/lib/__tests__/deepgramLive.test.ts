import { LiveTranscriber, type LiveSttStatus, type TranscriptResult } from '@/lib/stt/deepgramLive';
import { RELAY_CLOSE } from '@/lib/stt/relayProtocol';
import type { CaptureFrame } from '@/lib/audio/capture';
import { UtteranceAssembler, type Utterance } from '@/lib/stt/utterances';

const FRAME_SAMPLES = 800; // 50 ms at 16 kHz
const RELAY_URL = 'ws://localhost:3000/api/stt/stream?session=7f1c2a9e-3b4d-4c5e-8f60-1a2b3c4d5e6f';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType: BinaryType = 'blob';
  readonly sent: Array<string | ArrayBuffer> = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
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

  drop(code = 1006, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
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

function setup(getUrl: () => string = () => RELAY_URL, options: Record<string, unknown> = {}) {
  const transcriber = new LiveTranscriber({
    getUrl,
    random: () => 0,
    createSocket: (url) => new FakeSocket(url),
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
  it('opens one socket to the relay (no credentials in the browser) and flushes audio captured while connecting', async () => {
    const { transcriber, statuses } = setup();
    transcriber.start();
    transcriber.sendFrame(frame(1));
    transcriber.sendFrame(frame(2));
    await flush();

    const socket = FakeSocket.instances[0];
    expect(socket.url).toBe(RELAY_URL);
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
    const getUrl = jest.fn(() => RELAY_URL);
    const { transcriber, statuses, received } = setup(getUrl);
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
    expect(getUrl).toHaveBeenCalledTimes(2);
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

  it.each([
    [RELAY_CLOSE.quotaExceeded, 'You have used all your copilot minutes for now.'],
    [RELAY_CLOSE.sessionEnded, 'This copilot session has ended or expired.'],
    [RELAY_CLOSE.unauthorized, 'You were signed out. Sign in again to keep transcribing.'],
    [RELAY_CLOSE.replaced, 'Live transcription moved to another tab or window.'],
  ])('stops for good when the relay closes with %i', async (code, message) => {
    const { transcriber, statuses } = setup();
    transcriber.start();
    await flush();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop(code, 'reason from server');
    await jest.advanceTimersByTimeAsync(30_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(statuses.at(-1)).toEqual(['error', message]);
  });

  it('reconnects when the relay reports a Deepgram failure', async () => {
    const { transcriber, statuses } = setup();
    transcriber.start();
    await flush();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop(RELAY_CLOSE.upstreamFailed);
    expect(statuses.at(-1)?.[0]).toBe('reconnecting');

    await jest.advanceTimersByTimeAsync(250);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('waits the longest backoff when the relay rate-limits reconnects', async () => {
    const { transcriber } = setup();
    transcriber.start();
    await flush();
    FakeSocket.instances[0].drop(RELAY_CLOSE.rateLimited);

    await jest.advanceTimersByTimeAsync(7_999);
    expect(FakeSocket.instances).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('keeps retrying while the server is unreachable (Wi-Fi down)', async () => {
    const { transcriber, statuses } = setup();
    transcriber.start();
    for (let attempt = 0; attempt < 12; attempt++) {
      await flush();
      FakeSocket.instances[attempt].drop(1006); // never opened
      await jest.advanceTimersByTimeAsync(8_000);
    }

    expect(FakeSocket.instances.length).toBeGreaterThanOrEqual(12);
    expect(statuses.at(-1)).toEqual(['connecting', "Can't reach the live transcription server. Reconnecting…"]);
    FakeSocket.instances.at(-1)!.open();
    expect(transcriber.getStatus()).toBe('live');
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

describe('LiveTranscriber wall-clock times', () => {
  it('turns Deepgram word times into wall-clock speech-end times using the first frame', async () => {
    const { transcriber, received } = setup();
    transcriber.start();
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    // The first 50 ms frame arrived at t = 10,050 ms, so capture sample 0 was at 10,000 ms.
    transcriber.sendFrame({ ...frame(1), receivedAt: 10_050 });

    socket.receive(results(1, 1.2, 0.8, 'Why this company?', { is_final: true, speech_final: true }));
    expect(received[0].endedAt).toBe(12_000);
  });
});

describe('LiveTranscriber client voice detection', () => {
  /** A frame whose samples are all at `level` (0 = silence), with its id in the first sample. */
  function loud(id: number, level = 2000): CaptureFrame {
    const pcm = new Int16Array(FRAME_SAMPLES * 2).fill(level);
    pcm[0] = id;
    return { pcm, sampleRate: 16000, channels: 2, receivedAt: 0 };
  }
  const quiet = (id: number) => frame(id);

  it('skips long silence, sends a pre-roll when speech starts, and keeps Deepgram’s times on the capture clock', async () => {
    const { transcriber, received } = setup(undefined, { gateSilence: true });
    transcriber.start();
    FakeSocket.instances[0].open();
    await flush();

    // 3 s of silence (60 frames): nothing goes out.
    for (let i = 0; i < 60; i += 1) transcriber.sendFrame(quiet(1000 + i));
    expect(FakeSocket.instances[0].audioIds).toEqual([]);

    // Speech: the last 350 ms of silence (7 frames, then the boundary one) goes first, then the speech.
    transcriber.sendFrame(loud(1));
    const sent = FakeSocket.instances[0].audioIds;
    expect(sent.slice(-1)).toEqual([1]);
    expect(sent.length).toBeGreaterThanOrEqual(7);
    expect(sent.slice(0, -1).every((id) => id >= 1052)).toBe(true);

    // Deepgram's 0 s is the first pre-roll frame, which is 3 s - pre-roll into the capture.
    const firstSentSample = (sent[0] - 1000) * FRAME_SAMPLES;
    FakeSocket.instances[0].receive(results(1, 0.1, 0.2, 'hello', { is_final: true }));
    expect(received[0].startSec).toBeCloseTo(firstSentSample / 16000 + 0.1, 5);
  });

  it('keeps sending through the hangover after speech, then stops', async () => {
    const { transcriber } = setup(undefined, { gateSilence: true });
    transcriber.start();
    FakeSocket.instances[0].open();
    await flush();
    transcriber.sendFrame(loud(1));
    for (let i = 0; i < 40; i += 1) transcriber.sendFrame(quiet(100 + i)); // 2 s of silence
    const ids = FakeSocket.instances[0].audioIds;
    // 1.5 s of hangover (30 frames) still goes out; the rest doesn't.
    expect(ids).toContain(129);
    expect(ids).not.toContain(135);
  });
});

describe('LiveTranscriber phone / in-person mode', () => {
  /** A resolver stand-in: speaker 1 is the candidate, everyone else the interviewer. */
  function fakeSpeakers() {
    return {
      reset: jest.fn(),
      addSpeech: jest.fn(),
      role: jest.fn((speaker: number) => (speaker === 1 ? 'candidate' : 'interviewer')),
    };
  }

  function word(text: string, start: number, end: number, speaker: number) {
    return { word: text.toLowerCase(), punctuated_word: text, start, end, speaker };
  }

  async function phoneSetup() {
    const speakers = fakeSpeakers();
    const { transcriber, received } = setup(undefined, { speakers });
    transcriber.start();
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();
    // 2 s of audio in the ring buffer, for the voices' audio.
    for (let i = 0; i < 40; i += 1) transcriber.sendFrame(frame(i + 1));
    return { transcriber, received, socket, speakers };
  }

  it('sends only the microphone channel', async () => {
    const { socket } = await phoneSetup();
    const audio = socket.sent.filter((d): d is ArrayBuffer => typeof d !== 'string');
    expect(audio[0].byteLength).toBe(FRAME_SAMPLES * 2); // mono PCM16
    expect(socket.audioIds.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it("splits words by voice, and a change of voice ends the previous speaker's turn", async () => {
    const { received, socket, speakers } = await phoneSetup();
    const utterances: Utterance[] = [];
    const assembler = new UtteranceAssembler((u) => utterances.push(u));
    received.length = 0;

    const words = [word('Tell', 0, 0.3, 0), word('me', 0.3, 0.5, 0), word('more.', 0.5, 0.9, 0), word('Sure,', 1.0, 1.3, 1), word('I', 1.3, 1.4, 1)];
    socket.receive(results(0, 0, 1.5, 'Tell me more. Sure, I', { is_final: true, channel: { alternatives: [{ transcript: 'Tell me more. Sure, I', confidence: 0.9, words }] } }));
    received.forEach((r) => assembler.push(r));

    expect(received.map((r) => [r.role, r.text, r.speechFinal])).toEqual([
      ['interviewer', 'Tell me more.', false],
      ['interviewer', '', true],
      ['candidate', 'Sure, I', false],
      ['interviewer', '', false],
    ]);
    expect(utterances).toEqual([expect.objectContaining({ role: 'interviewer', text: 'Tell me more.', startSec: 0 })]);
    expect(utterances[0].endSec).toBeCloseTo(0.9, 5);
    // Each voice's audio goes to the resolver once, from the final result.
    expect(speakers.addSpeech.mock.calls.map(([speaker, pcm]) => [speaker, (pcm as Int16Array).length])).toEqual([
      [0, 14_400],
      [1, 6_400],
    ]);
  });

  it("shows interim words under each person, judging new voices from the interim audio", async () => {
    const { received, socket, speakers } = await phoneSetup();
    received.length = 0;
    const words = [word('So', 0.2, 0.4, 1), word('basically', 0.4, 0.9, 1)];
    socket.receive(results(0, 0, 1, 'So basically', { channel: { alternatives: [{ transcript: 'So basically', confidence: 0.8, words }] } }));
    expect(received.map((r) => [r.role, r.text, r.isFinal])).toEqual([
      ['candidate', 'So basically', false],
      ['interviewer', '', false],
    ]);
    expect(speakers.addSpeech).not.toHaveBeenCalled();
    expect(speakers.role).toHaveBeenCalledWith(1, expect.objectContaining({ pending: expect.any(Int16Array) }));
  });

  it("ends both people's turns on UtteranceEnd and starts fresh speaker numbers on reconnect", async () => {
    const { transcriber, socket, speakers } = await phoneSetup();
    const ends: string[] = [];
    transcriber.onUtteranceEnd((event) => ends.push(event.role));
    socket.receive({ type: 'UtteranceEnd', channel: [0, 1], last_word_end: 1.2 });
    expect(ends).toEqual(['candidate', 'interviewer']);

    expect(speakers.reset).toHaveBeenCalledTimes(1); // first open
    socket.drop();
    await jest.advanceTimersByTimeAsync(300);
    FakeSocket.instances[1].open();
    expect(speakers.reset).toHaveBeenCalledTimes(2);
  });
});
