/**
 * Streams the copilot's two-channel capture to Deepgram live (browser only).
 *
 * One WebSocket carries both speakers: frames are interleaved 16 kHz PCM16 with
 * channel 0 = candidate and channel 1 = interviewer, and Deepgram's
 * `multichannel` results say which channel they belong to.
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

import type { CaptureFrame, CaptureLevels, CaptureSource } from '@/lib/audio/capture';
import { hasSignal } from '@/lib/audio/levels';
import { FATAL_CLOSE_MESSAGES, RELAY_CLOSE } from './relayProtocol';

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
};

type BufferedFrame = { startSample: number; samples: number; pcm: Int16Array };

type DeepgramWord = { word?: string; punctuated_word?: string; start?: number; end?: number };

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
const CHANNELS = 2;
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
  /** Capture sample where the current connection's audio starts (Deepgram times are relative to it). */
  private connectionBaseSample: number | null = null;
  /** Per channel: capture sample up to which Deepgram has sent final results. */
  private finalizedUntil = [0, 0];
  /** Per channel: capture time already delivered as final when this connection opened. */
  private deliveredUntilSec = [0, 0];
  private lastSentAt = 0;

  private lastLoudAt = [0, 0];
  private speaking = [false, false];
  private finalizeRequested = [false, false];

  private readonly resultListeners = new Set<(result: TranscriptResult) => void>();
  private readonly utteranceEndListeners = new Set<(event: UtteranceEndEvent) => void>();
  private readonly speechStartedListeners = new Set<(event: SpeechStartedEvent) => void>();
  private readonly statusListeners = new Set<(status: LiveSttStatus, error: string | null) => void>();

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
    const samples = frame.pcm.length / CHANNELS;
    const buffered: BufferedFrame = { startSample: this.totalSamples, samples, pcm: frame.pcm };
    this.totalSamples += samples;
    this.ring.push(buffered);
    this.trimRing();
    if (this.status === 'live') this.sendPcm(buffered);
  }

  /** Feed capture levels; used to Finalize a channel as soon as its speaker goes quiet. */
  noteLevels(levels: CaptureLevels): void {
    const now = this.now();
    CHANNEL_ROLES.forEach((role, channel) => {
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

  onStatus(listener: (status: LiveSttStatus, error: string | null) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private connect(): void {
    this.setStatus(this.everLive ? 'reconnecting' : 'connecting');

    let socket: SocketLike;
    try {
      socket = this.createSocket(this.getUrl());
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Could not open the transcription connection.');
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
    this.deliveredUntilSec = this.finalizedUntil.map((sample) => sample / this.sampleRate);
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
      this.fail(fatal);
      return;
    }
    if (event.code === RELAY_CLOSE.rateLimited) {
      this.attempt = Math.max(this.attempt, BACKOFF_MS.length - 1); // wait the longest backoff
      this.scheduleReconnect('Too many reconnects in a minute; waiting before trying again.');
      return;
    }
    this.scheduleReconnect(
      event.code === RELAY_CLOSE.upstreamFailed
        ? 'The transcription service dropped the stream. Reconnecting…'
        : "Can't reach the live transcription server. Reconnecting…",
    );
  }

  private scheduleReconnect(reason: string): void {
    this.attempt += 1;
    this.setStatus(this.everLive ? 'reconnecting' : 'connecting', reason);
    const base = BACKOFF_MS[Math.min(this.attempt - 1, BACKOFF_MS.length - 1)];
    const delay = Math.round(base * (1 + 0.2 * this.random()));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private fail(message: string): void {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.setStatus('error', message);
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

    if (message.type === 'UtteranceEnd' && typeof message.last_word_end === 'number') {
      const event = { role, lastWordEndSec: this.toCaptureSeconds(message.last_word_end), receivedAt };
      this.utteranceEndListeners.forEach((listener) => listener(event));
    } else if (message.type === 'SpeechStarted' && typeof message.timestamp === 'number') {
      const event = { role, atSec: this.toCaptureSeconds(message.timestamp), receivedAt };
      this.speechStartedListeners.forEach((listener) => listener(event));
    }
  }

  private handleResults(message: DeepgramResults, receivedAt: number): void {
    const channel = message.channel_index?.[0] ?? 0;
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
    const words = alternative?.words ?? [];
    if (text && startSec < deliveredUntil && words.length > 0) {
      const fresh = words.filter(
        (word) => this.toCaptureSeconds(((word.start ?? 0) + (word.end ?? 0)) / 2) >= deliveredUntil,
      );
      if (fresh.length < words.length) {
        text = fresh.map((word) => word.punctuated_word ?? word.word ?? '').join(' ').trim();
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

    // Empty finals still go out: they clear any stale interim text for that speaker.
    if (!text && !isFinal) return;

    const result: TranscriptResult = {
      role,
      text,
      isFinal,
      speechFinal: isFinal && speechFinal,
      startSec,
      endSec,
      confidence: alternative?.confidence ?? 0,
      receivedAt,
    };
    this.resultListeners.forEach((listener) => listener(result));
  }

  private toCaptureSeconds(connectionSeconds: number): number {
    return (this.connectionBaseSample ?? 0) / this.sampleRate + connectionSeconds;
  }

  private setStatus(status: LiveSttStatus, error: string | null = null): void {
    if (this.status === status && error === null) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status, error));
  }
}
