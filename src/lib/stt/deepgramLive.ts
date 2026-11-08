/**
 * Streams the copilot's two-channel capture to Deepgram live (browser only).
 *
 * One WebSocket carries both speakers: frames are interleaved 16 kHz PCM16 with
 * channel 0 = candidate and channel 1 = interviewer, and Deepgram's
 * `multichannel` results say which channel they belong to.
 *
 * Phone / in-person mode (`speakers` set): only the microphone channel goes
 * out, Deepgram's diarization numbers the voices, and a SpeakerResolver says
 * which number is the candidate (src/lib/stt/speakers.ts).
 *
 * Audio goes through our relay (src/server/sttRelay.ts), which holds the
 * Deepgram key and ends the stream when the session stops or runs out of
 * minutes; its close codes say when reconnecting can't help.
 *
 * Reliability:
 * - Reconnects with backoff for as long as the server can't be reached.
 * - The last few seconds of audio stay in a ring buffer. After a reconnect we
 *   replay everything Deepgram hadn't finalized yet, then drop any words that
 *   were already final, so a Wi-Fi blip neither loses nor repeats speech.
 * - KeepAlive goes out when no audio has been sent for a while.
 * - When a channel goes quiet we send Finalize so its last words come back as
 *   final without waiting for Deepgram's own end-of-speech detection.
 */

import { micChannel, type CaptureFrame, type CaptureLevels, type CaptureSource } from '@/lib/audio/capture';
import { hasSignal } from '@/lib/audio/levels';
import { FATAL_CLOSE_CODES, FATAL_CLOSE_MESSAGES, RELAY_CLOSE, type SttErrorCode } from './relayProtocol';
import type { SpeakerResolver } from './speakers';

export type SpeakerRole = CaptureSource;

/** Channel index → speaker. Matches the capture worklet's channel order. */
export const CHANNEL_ROLES: readonly SpeakerRole[] = ['candidate', 'interviewer'];

export type TranscriptResult = {
  role: SpeakerRole;
  text: string;
  isFinal: boolean;
  /** The speaker finished: Deepgram endpointing, or a Finalize we sent because their channel went quiet. */
  speechFinal: boolean;
  /** Seconds since capture started (not since this connection opened). */
  startSec: number;
  endSec: number;
  /** Wall-clock time (ms) the last word ended, or null before any audio arrived. */
  endedAt?: number | null;
  confidence: number;
  receivedAt: number;
};

export type UtteranceEndEvent = { role: SpeakerRole; lastWordEndSec: number; receivedAt: number };
export type SpeechStartedEvent = { role: SpeakerRole; atSec: number; receivedAt: number };

export type LiveSttStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';

type SocketLike = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'binaryType'> & {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
};

export type LiveTranscriberOptions = {
  /** The relay URL for this session (see sttStreamUrl). */
  getUrl: () => string;
  sampleRate?: number;
  /** Seconds of audio kept for replay after a reconnect. */
  bufferSeconds?: number;
  /** Send KeepAlive when no audio went out for this long (Deepgram closes after ~10 s). */
  keepAliveMs?: number;
  /** A channel that had speech and has been quiet this long triggers Finalize. */
  finalizeAfterQuietMs?: number;
  /** Max time to wait for Deepgram's last results after CloseStream. */
  closeTimeoutMs?: number;
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  random?: () => number;
  /**
   * Client-side voice detection: while both channels are silent, audio isn't
   * sent (KeepAlive holds the connection), which cuts transcription cost. Speech
   * resumes with a short pre-roll so first syllables aren't lost, and the
   * stream keeps sending through a hangover longer than Deepgram's
   * end-of-utterance window so endpointing still sees the silence it needs.
   */
  gateSilence?: boolean;
  /** RMS level (0–1) above which a frame counts as speech. */
  voiceThreshold?: number;
  /** Phone / in-person mode: send the microphone only and tell the voices apart with this. */
  speakers?: SpeakerResolver;
};

type BufferedFrame = { startSample: number; samples: number; pcm: Int16Array };

/** A run of contiguous audio sent on one connection: where it starts in Deepgram's time and in capture samples. */
type SentSegment = { connectionSec: number; captureSample: number };

const PRE_ROLL_SECONDS = 0.35;
const HANGOVER_SECONDS = 1.5;

/** The louder channel's RMS level (0–1) of an interleaved PCM16 frame. */
export function frameLevel(pcm: Int16Array, channels = 2): number {
  const sums = new Array<number>(channels).fill(0);
  for (let i = 0; i < pcm.length; i += 1) sums[i % channels] += pcm[i] * pcm[i];
  const perChannel = pcm.length / channels || 1;
  return Math.max(...sums.map((sum) => Math.sqrt(sum / perChannel) / 32768));
}

type DeepgramWord = { word?: string; punctuated_word?: string; start?: number; end?: number; speaker?: number };

/** Consecutive words from one diarized voice, in connection seconds. */
type SpeakerSpan = { speaker: number; start: number; end: number; text: string };

function speakerSpans(words: DeepgramWord[]): SpeakerSpan[] {
  const spans: SpeakerSpan[] = [];
  for (const word of words) {
    const speaker = typeof word.speaker === 'number' ? word.speaker : 0;
    const token = word.punctuated_word ?? word.word ?? '';
    const last = spans.at(-1);
    if (last && last.speaker === speaker) {
      last.end = word.end ?? last.end;
      last.text = `${last.text} ${token}`.trim();
    } else {
      spans.push({ speaker, start: word.start ?? 0, end: word.end ?? word.start ?? 0, text: token });
    }
  }
  return spans;
}


type DeepgramResults = {
  type: 'Results';
  channel_index?: number[];
  start?: number;
  duration?: number;
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string; confidence?: number; words?: DeepgramWord[] }> };
};

const OPEN = 1;
/** The capture always delivers both channels; phone mode sends only the first. */
const CAPTURE_CHANNELS = 2;
const BACKOFF_MS = [250, 500, 1_000, 2_000, 4_000, 8_000];

export class LiveTranscriber {
  private readonly getUrl: () => string;
  private readonly sampleRate: number;
  private readonly bufferSamples: number;
  private readonly keepAliveMs: number;
  private readonly finalizeAfterQuietMs: number;
  private readonly closeTimeoutMs: number;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly gateSilence: boolean;
  private readonly voiceThreshold: number;
  private readonly speakers: SpeakerResolver | null;
  /** Channels sent to Deepgram. */
  private readonly channels: number;
  /** Phone mode: whose final words came last, so a change of voice ends the previous turn. */
  private lastFinalRole: SpeakerRole | null = null;

  private status: LiveSttStatus = 'idle';
  private socket: SocketLike | null = null;
  /** Consecutive reconnects without a final result; drives the backoff. */
  private attempt = 0;
  private everLive = false;
  private stopping = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private stopResolvers: Array<() => void> = [];

  private ring: BufferedFrame[] = [];
  private totalSamples = 0;
  private captureStartedAt: number | null = null;
  /** Capture sample where the current connection's audio starts (Deepgram times are relative to it). */
  private connectionBaseSample: number | null = null;
  /** With voice detection, the connection's audio has gaps: each sent run maps Deepgram time back to capture time. */
  private segments: SentSegment[] = [];
  private connectionSentSamples = 0;
  private nextSentSample: number | null = null;
  /** Capture sample of the last frame with voice in it. */
  private lastVoiceSample = -Infinity;
  /** Per channel: capture sample up to which Deepgram has sent final results. */
  private finalizedUntil: number[];
  /** Per channel: capture time already delivered as final when this connection opened. */
  private deliveredUntilSec: number[];
  private lastSentAt = 0;

  private lastLoudAt = [0, 0];
  private speaking = [false, false];
  private finalizeRequested = [false, false];

  private readonly resultListeners = new Set<(result: TranscriptResult) => void>();
  private readonly utteranceEndListeners = new Set<(event: UtteranceEndEvent) => void>();
  private readonly speechStartedListeners = new Set<(event: SpeechStartedEvent) => void>();
  private readonly statusListeners = new Set<(status: LiveSttStatus, error: string | null, code: SttErrorCode | null) => void>();

  constructor(options: LiveTranscriberOptions) {
    this.getUrl = options.getUrl;
    this.sampleRate = options.sampleRate ?? 16000;
    this.bufferSamples = Math.round((options.bufferSeconds ?? 10) * this.sampleRate);
    this.keepAliveMs = options.keepAliveMs ?? 4_000;
    this.finalizeAfterQuietMs = options.finalizeAfterQuietMs ?? 600;
    this.closeTimeoutMs = options.closeTimeoutMs ?? 2_000;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? (() => Math.random());
    this.gateSilence = options.gateSilence ?? false;
    this.voiceThreshold = options.voiceThreshold ?? 0.008;
    this.speakers = options.speakers ?? null;
    this.channels = this.speakers ? 1 : CAPTURE_CHANNELS;
    this.finalizedUntil = new Array<number>(this.channels).fill(0);
    this.deliveredUntilSec = new Array<number>(this.channels).fill(0);
  }

  getStatus(): LiveSttStatus {
    return this.status;
  }

  start(): void {
    if (this.status !== 'idle') return;
    this.keepAliveTimer = setInterval(() => this.keepAlive(), this.keepAliveMs);
    this.connect();
  }

  /** Feed one capture frame. Safe to call while (re)connecting: frames wait in the ring buffer. */
  sendFrame(frame: CaptureFrame): void {
    if (this.stopping || this.status === 'error' || this.status === 'closed') return;
    const samples = frame.pcm.length / CAPTURE_CHANNELS;
    // Wall-clock time of capture sample 0, so Deepgram's word times can be compared with other events.
    this.captureStartedAt ??= frame.receivedAt - (samples / this.sampleRate) * 1000;
    const pcm = this.channels === 1 ? micChannel(frame.pcm) : frame.pcm;
    const buffered: BufferedFrame = { startSample: this.totalSamples, samples, pcm };
    this.totalSamples += samples;
    this.ring.push(buffered);
    this.trimRing();
    if (this.status !== 'live') return;
    if (!this.gateSilence) {
      this.sendPcm(buffered);
      return;
    }
    const voiced = frameLevel(pcm, this.channels) >= this.voiceThreshold;
    if (voiced) {
      const resuming = buffered.startSample - this.lastVoiceSample > HANGOVER_SECONDS * this.sampleRate;
      this.lastVoiceSample = buffered.startSample + samples;
      // Coming back from silence: send the pre-roll first so the first syllable isn't cut.
      if (resuming) this.sendPreRoll(buffered.startSample);
      this.sendPcm(buffered);
    } else if (buffered.startSample - this.lastVoiceSample <= HANGOVER_SECONDS * this.sampleRate) {
      this.sendPcm(buffered);
    }
  }

  /** Frames from just before `beforeSample` that weren't sent yet. */
  private sendPreRoll(beforeSample: number): void {
    const from = beforeSample - PRE_ROLL_SECONDS * this.sampleRate;
    for (const frame of this.ring) {
      if (frame.startSample >= beforeSample) break;
      if (frame.startSample + frame.samples > from && (this.nextSentSample === null || frame.startSample >= this.nextSentSample)) {
        this.sendPcm(frame);
      }
    }
  }

  /** Feed capture levels; used to Finalize a channel as soon as its speaker goes quiet. */
  noteLevels(levels: CaptureLevels): void {
    const now = this.now();
    CHANNEL_ROLES.slice(0, this.channels).forEach((role, channel) => {
      if (hasSignal(levels[role])) {
        this.lastLoudAt[channel] = now;
        this.speaking[channel] = true;
        this.finalizeRequested[channel] = false;
      } else if (this.speaking[channel] && now - this.lastLoudAt[channel] >= this.finalizeAfterQuietMs) {
        this.speaking[channel] = false;
        this.finalizeRequested[channel] = true;
        this.sendControl({ type: 'Finalize' });
      }
    });
  }

  /** Flushes Deepgram's last results, then closes. Resolves once the socket is closed. */
  stop(): Promise<void> {
    if (this.status === 'idle' || this.status === 'closed' || this.status === 'error') {
      this.clearTimers();
      this.setStatus('closed');
      return Promise.resolve();
    }
    const done = new Promise<void>((resolve) => this.stopResolvers.push(resolve));
    if (this.stopping) return done;
    this.stopping = true;
    this.clearTimers();

    const socket = this.socket;
    if (socket && socket.readyState === OPEN) {
      socket.send(JSON.stringify({ type: 'CloseStream' }));
      this.closeTimer = setTimeout(() => socket.close(1000), this.closeTimeoutMs);
    } else {
      this.socket = null;
      socket?.close(1000);
      this.finishStop();
    }
    return done;
  }

  onResult(listener: (result: TranscriptResult) => void): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  onUtteranceEnd(listener: (event: UtteranceEndEvent) => void): () => void {
    this.utteranceEndListeners.add(listener);
    return () => this.utteranceEndListeners.delete(listener);
  }

  onSpeechStarted(listener: (event: SpeechStartedEvent) => void): () => void {
    this.speechStartedListeners.add(listener);
    return () => this.speechStartedListeners.delete(listener);
  }

  /** `error` is English for logs and tests; `code` says the same for the UI's own messages. */
  onStatus(listener: (status: LiveSttStatus, error: string | null, code: SttErrorCode | null) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private connect(): void {
    this.setStatus(this.everLive ? 'reconnecting' : 'connecting');

    let socket: SocketLike;
    try {
      socket = this.createSocket(this.getUrl());
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Could not open the transcription connection.', 'openFailed');
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.handleOpen();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.handleMessage(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.handleClose(event);
    };
    // A close event always follows an error; handle everything there.
    socket.onerror = () => undefined;
  }

  private handleOpen(): void {
    this.everLive = true;
    this.connectionBaseSample = null;
    this.segments = [];
    this.connectionSentSamples = 0;
    this.nextSentSample = null;
    this.deliveredUntilSec = this.finalizedUntil.map((sample) => sample / this.sampleRate);
    this.speakers?.reset();
    this.setStatus('live');

    // Replay whatever Deepgram never finalized: the tail of the last connection
    // and everything captured while we were disconnected.
    const replayFrom = Math.min(...this.finalizedUntil);
    for (const frame of this.ring) {
      if (frame.startSample + frame.samples > replayFrom) this.sendPcm(frame);
    }
  }

  private handleClose(event: CloseEvent): void {
    if (this.stopping) {
      this.finishStop();
      return;
    }
    const fatal = FATAL_CLOSE_MESSAGES[event.code];
    if (fatal) {
      this.fail(fatal, FATAL_CLOSE_CODES[event.code]);
      return;
    }
    if (event.code === RELAY_CLOSE.rateLimited) {
      this.attempt = Math.max(this.attempt, BACKOFF_MS.length - 1); // wait the longest backoff
      this.scheduleReconnect('Too many reconnects in a minute; waiting before trying again.', 'rateLimited');
      return;
    }
    if (event.code === RELAY_CLOSE.upstreamFailed) {
      this.scheduleReconnect('The transcription service dropped the stream. Reconnecting…', 'upstreamFailed');
    } else {
      this.scheduleReconnect("Can't reach the live transcription server. Reconnecting…", 'unreachable');
    }
  }

  private scheduleReconnect(reason: string, code: SttErrorCode): void {
    this.attempt += 1;
    this.setStatus(this.everLive ? 'reconnecting' : 'connecting', reason, code);
    const base = BACKOFF_MS[Math.min(this.attempt - 1, BACKOFF_MS.length - 1)];
    const delay = Math.round(base * (1 + 0.2 * this.random()));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private fail(message: string, code: SttErrorCode): void {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.setStatus('error', message, code);
  }

  private finishStop(): void {
    this.clearTimers();
    this.setStatus('closed');
    const resolvers = this.stopResolvers;
    this.stopResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.reconnectTimer = null;
    this.keepAliveTimer = null;
    this.closeTimer = null;
  }

  private keepAlive(): void {
    if (this.now() - this.lastSentAt >= this.keepAliveMs) this.sendControl({ type: 'KeepAlive' });
  }

  private sendPcm(frame: BufferedFrame): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    if (this.connectionBaseSample === null) this.connectionBaseSample = frame.startSample;
    // A gap in what we send starts a new segment, so Deepgram's times still map to capture time.
    if (this.nextSentSample !== frame.startSample) {
      this.segments.push({ connectionSec: this.connectionSentSamples / this.sampleRate, captureSample: frame.startSample });
    }
    this.connectionSentSamples += frame.samples;
    this.nextSentSample = frame.startSample + frame.samples;
    const { pcm } = frame;
    const whole = pcm.byteOffset === 0 && pcm.byteLength === pcm.buffer.byteLength;
    socket.send(whole ? pcm.buffer : pcm.slice().buffer);
    this.lastSentAt = this.now();
  }

  private sendControl(message: { type: 'KeepAlive' | 'Finalize' | 'CloseStream' }): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN || this.status !== 'live' || this.stopping) return;
    socket.send(JSON.stringify(message));
    this.lastSentAt = this.now();
  }

  private trimRing(): void {
    const keepFrom = this.totalSamples - this.bufferSamples;
    let drop = 0;
    while (drop < this.ring.length && this.ring[drop].startSample + this.ring[drop].samples <= keepFrom) drop += 1;
    if (drop > 0) this.ring.splice(0, drop);
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: { type?: string } & Record<string, unknown>;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    const receivedAt = this.now();

    if (message.type === 'Results') {
      this.handleResults(message as unknown as DeepgramResults, receivedAt);
      return;
    }

    const channel = Array.isArray(message.channel) ? Number(message.channel[0]) : NaN;
    const role = CHANNEL_ROLES[channel];
    if (!role) return;

    // Phone mode: the one channel carries both people, so the event is for both.
    const roles = this.speakers ? CHANNEL_ROLES : [role];
    if (message.type === 'UtteranceEnd' && typeof message.last_word_end === 'number') {
      const lastWordEndSec = this.toCaptureSeconds(message.last_word_end);
      roles.forEach((r) => this.utteranceEndListeners.forEach((listener) => listener({ role: r, lastWordEndSec, receivedAt })));
    } else if (message.type === 'SpeechStarted' && typeof message.timestamp === 'number') {
      const atSec = this.toCaptureSeconds(message.timestamp);
      roles.forEach((r) => this.speechStartedListeners.forEach((listener) => listener({ role: r, atSec, receivedAt })));
    }
  }

  /**
   * The channel a message names, when it's one this connection sends; -1 for anything else. The index
   * comes off the wire and picks which per-channel slot is written, so only an index we know gets through.
   */
  private channelOf(index: unknown): number {
    for (let channel = 0; channel < this.channels; channel += 1) {
      if (index === channel) return channel;
    }
    return -1;
  }

  private handleResults(message: DeepgramResults, receivedAt: number): void {
    const channel = this.channelOf(message.channel_index?.[0] ?? 0);
    const role = CHANNEL_ROLES[channel];
    if (!role || this.connectionBaseSample === null) return;

    const startSec = this.toCaptureSeconds(message.start ?? 0);
    const endSec = this.toCaptureSeconds((message.start ?? 0) + (message.duration ?? 0));
    const alternative = message.channel?.alternatives?.[0];
    const isFinal = message.is_final === true;

    // Replay starts on a frame boundary at or before the finalized edge, so the
    // first results of a new connection can repeat words the previous one already
    // delivered. Drop words whose midpoint falls inside that delivered region.
    const deliveredUntil = this.deliveredUntilSec[channel];
    let text = alternative?.transcript?.trim() ?? '';
    let words = alternative?.words ?? [];
    if (text && startSec < deliveredUntil && words.length > 0) {
      const fresh = words.filter(
        (word) => this.toCaptureSeconds(((word.start ?? 0) + (word.end ?? 0)) / 2) >= deliveredUntil,
      );
      if (fresh.length < words.length) {
        text = fresh.map((word) => word.punctuated_word ?? word.word ?? '').join(' ').trim();
        words = fresh;
      }
    }

    if (isFinal) {
      // Every final, including empty ones for silence, moves the replay point forward.
      this.finalizedUntil[channel] = Math.max(this.finalizedUntil[channel], Math.round(endSec * this.sampleRate));
      // Healthy connection: Deepgram is answering.
      this.attempt = 0;
    }

    let speechFinal = message.speech_final === true;
    if (message.from_finalize && this.finalizeRequested[channel]) {
      speechFinal = true;
      this.finalizeRequested[channel] = false;
    }

    if (this.speakers) {
      this.emitBySpeaker(text ? words : [], text, {
        isFinal,
        speechFinal: isFinal && speechFinal,
        startSec,
        endSec,
        endedAt: this.wallClockMs(endSec),
        confidence: alternative?.confidence ?? 0,
        receivedAt,
      });
      return;
    }

    // Empty finals still go out: they clear any stale interim text for that speaker.
    if (!text && !isFinal) return;

    const result: TranscriptResult = {
      role,
      text,
      isFinal,
      speechFinal: isFinal && speechFinal,
      startSec,
      endSec,
      endedAt: this.captureStartedAt === null ? null : this.captureStartedAt + endSec * 1000,
      confidence: alternative?.confidence ?? 0,
      receivedAt,
    };
    this.resultListeners.forEach((listener) => listener(result));
  }

  /**
   * Phone / in-person mode: one channel carries both people. Words are split
   * by Deepgram's speaker number, each voice is labelled through the voice
   * sample, and a change of voice ends the previous speaker's turn. Every
   * result also clears the other person's interim words, which it replaces.
   */
  private emitBySpeaker(words: DeepgramWord[], text: string, result: Omit<TranscriptResult, 'role' | 'text'>): void {
    const speakers = this.speakers as SpeakerResolver;
    const spans = words.length
      ? speakerSpans(words).map((span) => ({ ...span, start: this.toCaptureSeconds(span.start), end: this.toCaptureSeconds(span.end) }))
      : text
        ? [{ speaker: 0, start: result.startSec, end: result.endSec, text }]
        : [];

    const runs: Array<{ role: SpeakerRole; text: string; startSec: number; endSec: number }> = [];
    for (const span of spans) {
      const audio = this.ringSlice(span.start, span.end);
      const atMs = this.wallClockMs(span.start);
      // Finals are added once; interim audio only informs the guess, since it comes again as final.
      if (result.isFinal && audio.length > 0) speakers.addSpeech(span.speaker, audio, atMs);
      const role = speakers.role(span.speaker, { pending: result.isFinal ? undefined : audio, atMs });
      const last = runs.at(-1);
      if (last && last.role === role) {
        last.text = `${last.text} ${span.text}`.trim();
        last.endSec = span.end;
      } else {
        runs.push({ role, text: span.text, startSec: span.start, endSec: span.end });
      }
    }

    const emit = (next: TranscriptResult) => this.resultListeners.forEach((listener) => listener(next));
    if (!result.isFinal) {
      for (const role of CHANNEL_ROLES) {
        const said = runs.filter((run) => run.role === role).map((run) => run.text).join(' ');
        emit({ ...result, role, text: said, speechFinal: false });
      }
      return;
    }

    runs.forEach((run, index) => {
      if (this.lastFinalRole && this.lastFinalRole !== run.role) {
        // The other person started talking: the previous turn is over.
        emit({ ...result, role: this.lastFinalRole, text: '', speechFinal: true, startSec: run.startSec, endSec: run.startSec });
      }
      this.lastFinalRole = run.role;
      emit({
        ...result,
        role: run.role,
        text: run.text,
        speechFinal: index === runs.length - 1 && result.speechFinal,
        startSec: run.startSec,
        endSec: run.endSec,
        endedAt: this.wallClockMs(run.endSec),
      });
    });
    const lastRole = runs.at(-1)?.role;
    for (const role of CHANNEL_ROLES) {
      if (role !== lastRole) emit({ ...result, role, text: '' });
    }
  }

  /** Mono audio between two capture times, from the ring buffer (phone mode). */
  private ringSlice(fromSec: number, toSec: number): Int16Array {
    const from = Math.max(0, Math.floor(fromSec * this.sampleRate));
    const to = Math.floor(toSec * this.sampleRate);
    if (to <= from) return new Int16Array(0);
    const out = new Int16Array(to - from);
    for (const frame of this.ring) {
      const start = Math.max(from, frame.startSample);
      const end = Math.min(to, frame.startSample + frame.samples);
      if (end > start) out.set(frame.pcm.subarray(start - frame.startSample, end - frame.startSample), start - from);
    }
    return out;
  }

  private wallClockMs(captureSeconds: number): number | null {
    return this.captureStartedAt === null ? null : this.captureStartedAt + captureSeconds * 1000;
  }

  private toCaptureSeconds(connectionSeconds: number): number {
    let segment: SentSegment | undefined;
    for (const candidate of this.segments) {
      if (candidate.connectionSec <= connectionSeconds + 1e-6) segment = candidate;
      else break;
    }
    if (!segment) return (this.connectionBaseSample ?? 0) / this.sampleRate + connectionSeconds;
    return segment.captureSample / this.sampleRate + (connectionSeconds - segment.connectionSec);
  }

  private setStatus(status: LiveSttStatus, error: string | null = null, code: SttErrorCode | null = null): void {
    if (this.status === status && error === null) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status, error, code));
  }
}
