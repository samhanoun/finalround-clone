/**
 * Live speech-to-text relay: browser ⇄ this server ⇄ Deepgram.
 *
 * The browser never holds a Deepgram credential. It opens a WebSocket to
 * STT_STREAM_PATH with its normal session cookie; we check who it is, that it
 * owns an active copilot session with minutes left, then open the Deepgram
 * stream ourselves with fixed parameters. While audio flows we keep checking,
 * and close the stream when the session stops, expires or runs out of quota.
 *
 * Runs in the custom Node server (server.ts). Imports stay relative and
 * alias-free so the server can be compiled with plain `tsc`.
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { checkIngestConsent } from '../lib/copilotConsent';
import { isSessionHeartbeatExpired } from '../lib/copilotSession';
import { RELAY_CLOSE } from '../lib/stt/relayProtocol';

export { RELAY_CLOSE, STT_STREAM_PATH } from '../lib/stt/relayProtocol';

export type RelaySession = {
  id: string;
  user_id: string;
  status: string;
  started_at: string;
  metadata: Record<string, unknown> | null;
};

export type RelayDeps = {
  /** The signed-in user's id from the upgrade request's cookies, or null. */
  authenticate: (req: IncomingMessage) => Promise<string | null>;
  /** Reads the session with server privileges (not the user's token, which can expire mid-call). */
  loadSession: (sessionId: string) => Promise<RelaySession | null>;
  /** Minutes the user's plan has left today/this month/this session (the smallest). */
  remainingMinutes: (userId: string) => Promise<number>;
  /** Opens the Deepgram live connection with our key and fixed parameters. */
  openUpstream: () => WebSocket;
  /** Origins allowed to open a stream, besides the request's own host. */
  allowedOrigins?: string[];
  /** False when the Deepgram key is missing: streams close with notConfigured. */
  configured?: boolean;
  sessionCheckMs?: number;
  quotaCheckMs?: number;
  connectsPerMinute?: number;
  upstreamOpenTimeoutMs?: number;
  now?: () => number;
  log?: (event: string, meta: Record<string, unknown>) => void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 50 ms of 16 kHz stereo PCM16 is 3,200 bytes; leave room for larger frames. */
const MAX_AUDIO_FRAME_BYTES = 64 * 1024;
const ALLOWED_CONTROLS = new Set(['KeepAlive', 'Finalize', 'CloseStream']);
const MAX_CHECK_FAILURES = 3;

type Stream = {
  client: WebSocket;
  upstream: WebSocket;
  userId: string;
  session: RelaySession;
  timers: Array<ReturnType<typeof setInterval>>;
  closed: boolean;
};

function elapsedMinutes(startedAt: string, now: number): number {
  const started = new Date(startedAt).getTime();
  return Math.max(1, Math.ceil(Math.max(0, now - started) / 60_000));
}

function originAllowed(req: IncomingMessage, allowed: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const { host } = new URL(origin);
    return host === req.headers.host || allowed.includes(origin);
  } catch {
    return false;
  }
}

export function createSttRelay(deps: RelayDeps) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_AUDIO_FRAME_BYTES });
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => undefined);
  const sessionCheckMs = deps.sessionCheckMs ?? 15_000;
  const quotaCheckMs = deps.quotaCheckMs ?? 60_000;
  const connectsPerMinute = deps.connectsPerMinute ?? 12;
  const upstreamOpenTimeoutMs = deps.upstreamOpenTimeoutMs ?? 10_000;
  const connectLog = new Map<string, number[]>();
  const streamsBySession = new Map<string, Stream>();

  /** Completes the upgrade so the browser can read why it was refused (it can't see HTTP errors). */
  function refuse(req: IncomingMessage, socket: Duplex, head: Buffer, code: number, reason: string) {
    wss.handleUpgrade(req, socket, head, (client) => client.close(code, reason));
  }

  function rateLimited(userId: string): boolean {
    const t = now();
    const recent = (connectLog.get(userId) ?? []).filter((at) => t - at < 60_000);
    recent.push(t);
    connectLog.set(userId, recent);
    return recent.length > connectsPerMinute;
  }

  function sessionProblem(session: RelaySession | null, userId: string): [number, string] | null {
    if (!session || session.user_id !== userId) return [RELAY_CLOSE.sessionNotFound, 'session_not_found'];
    if (session.status !== 'active') return [RELAY_CLOSE.sessionEnded, 'session_not_active'];
    if (isSessionHeartbeatExpired(session)) return [RELAY_CLOSE.sessionEnded, 'session_expired'];
    const consent = checkIngestConsent(session);
    if (!consent.allowed) return [RELAY_CLOSE.sessionEnded, consent.reason];
    return null;
  }

  async function quotaProblem(userId: string, session: RelaySession): Promise<[number, string] | null> {
    const remaining = await deps.remainingMinutes(userId);
    return elapsedMinutes(session.started_at, now()) > remaining ? [RELAY_CLOSE.quotaExceeded, 'quota_exceeded'] : null;
  }

  function endStream(stream: Stream, code: number, reason: string) {
    if (stream.closed) return;
    stream.closed = true;
    stream.timers.forEach(clearInterval);
    if (streamsBySession.get(stream.session.id) === stream) streamsBySession.delete(stream.session.id);
    if (stream.client.readyState === WebSocket.OPEN || stream.client.readyState === WebSocket.CONNECTING) {
      stream.client.close(code, reason);
    }
    if (stream.upstream.readyState === WebSocket.OPEN || stream.upstream.readyState === WebSocket.CONNECTING) {
      stream.upstream.terminate();
    }
    log('stream_closed', { sessionId: stream.session.id, userId: stream.userId, code, reason });
  }

  function openUpstream(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const upstream = deps.openUpstream();
      const timer = setTimeout(() => {
        upstream.terminate();
        reject(new Error('upstream_timeout'));
      }, upstreamOpenTimeoutMs);
      upstream.once('open', () => {
        clearTimeout(timer);
        resolve(upstream);
      });
      upstream.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      upstream.once('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        upstream.terminate();
        reject(new Error(`upstream_http_${res.statusCode}`));
      });
    });
  }

  function pipe(stream: Stream) {
    const { client, upstream } = stream;
    let clientAskedToClose = false;

    client.on('message', (data: RawData, isBinary: boolean) => {
      if (upstream.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        const bytes = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        if (bytes.length === 0 || bytes.length % 2 !== 0) return; // not PCM16
        upstream.send(bytes, { binary: true });
        return;
      }
      // Only our three control messages pass; the browser can't change parameters.
      try {
        const { type } = JSON.parse(data.toString()) as { type?: unknown };
        if (typeof type !== 'string' || !ALLOWED_CONTROLS.has(type)) return;
        if (type === 'CloseStream') clientAskedToClose = true;
        upstream.send(JSON.stringify({ type }));
      } catch {
        // ignore malformed control messages
      }
    });

    upstream.on('message', (data: RawData, isBinary: boolean) => {
      if (client.readyState !== WebSocket.OPEN || isBinary) return;
      client.send(data.toString());
    });

    client.on('close', () => endStream(stream, 1000, 'client_closed'));
    client.on('error', () => endStream(stream, 1011, 'client_error'));
    upstream.on('close', (code) => {
      if (clientAskedToClose && code === 1000) endStream(stream, 1000, 'stream_finished');
      else endStream(stream, RELAY_CLOSE.upstreamFailed, `upstream_closed_${code}`);
    });
    upstream.on('error', () => endStream(stream, RELAY_CLOSE.upstreamFailed, 'upstream_error'));
  }

  function watch(stream: Stream) {
    let failures = 0;
    const guard = (check: () => Promise<[number, string] | null>) => async () => {
      if (stream.closed) return;
      try {
        const problem = await check();
        failures = 0;
        if (problem) endStream(stream, problem[0], problem[1]);
      } catch (error) {
        failures += 1;
        log('check_failed', { sessionId: stream.session.id, failures, error: String(error) });
        // Tolerate a blip; a reconnect re-runs every check from scratch.
        if (failures >= MAX_CHECK_FAILURES) endStream(stream, RELAY_CLOSE.upstreamFailed, 'checks_failing');
      }
    };

    stream.timers.push(
      setInterval(
        guard(async () => {
          const session = await deps.loadSession(stream.session.id);
          if (session) stream.session = session;
          return sessionProblem(session, stream.userId);
        }),
        sessionCheckMs,
      ),
      setInterval(
        guard(() => quotaProblem(stream.userId, stream.session)),
        quotaCheckMs,
      ),
    );
  }

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://relay.local');
    const sessionId = url.searchParams.get('session') ?? '';
    // The checks below take a moment; the browser may give up meanwhile.
    let gone = false;
    socket.once('close', () => {
      gone = true;
    });

    if (!originAllowed(req, deps.allowedOrigins ?? [])) {
      refuse(req, socket, head, RELAY_CLOSE.badRequest, 'origin_not_allowed');
      return;
    }
    if (!UUID.test(sessionId)) {
      refuse(req, socket, head, RELAY_CLOSE.badRequest, 'invalid_session');
      return;
    }
    if (deps.configured === false) {
      refuse(req, socket, head, RELAY_CLOSE.notConfigured, 'stt_not_configured');
      return;
    }

    let userId: string | null;
    let session: RelaySession | null;
    let problem: [number, string] | null;
    try {
      userId = await deps.authenticate(req);
      if (!userId) {
        refuse(req, socket, head, RELAY_CLOSE.unauthorized, 'unauthorized');
        return;
      }
      if (rateLimited(userId)) {
        refuse(req, socket, head, RELAY_CLOSE.rateLimited, 'rate_limited');
        return;
      }
      session = await deps.loadSession(sessionId);
      problem = sessionProblem(session, userId) ?? (session ? await quotaProblem(userId, session) : null);
    } catch (error) {
      log('connect_checks_failed', { sessionId, error: String(error) });
      refuse(req, socket, head, RELAY_CLOSE.upstreamFailed, 'checks_failed');
      return;
    }
    if (problem || !session) {
      refuse(req, socket, head, ...(problem ?? [RELAY_CLOSE.sessionNotFound, 'session_not_found']));
      return;
    }

    // Open Deepgram before accepting the browser, so its first frames have somewhere to go.
    let upstream: WebSocket;
    try {
      upstream = await openUpstream();
    } catch (error) {
      log('upstream_open_failed', { sessionId, error: String(error) });
      refuse(req, socket, head, RELAY_CLOSE.upstreamFailed, 'upstream_unavailable');
      return;
    }
    if (gone) {
      upstream.terminate();
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      const stream: Stream = { client, upstream, userId, session, timers: [], closed: false };
      // One stream per session: a newer tab or reconnect takes over.
      const previous = streamsBySession.get(session.id);
      streamsBySession.set(session.id, stream);
      if (previous) endStream(previous, RELAY_CLOSE.replaced, 'replaced');
      pipe(stream);
      watch(stream);
      log('stream_opened', { sessionId: session.id, userId });
    });
  }

  function close() {
    streamsBySession.forEach((stream) => endStream(stream, 1001, 'server_shutdown'));
    wss.close();
  }

  return { handleUpgrade, close, activeStreams: () => streamsBySession.size };
}

export type SttRelay = ReturnType<typeof createSttRelay>;
