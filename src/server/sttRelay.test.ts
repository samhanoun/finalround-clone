/**
 * @jest-environment node
 */
import { createServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { RELAY_CLOSE, STT_STREAM_PATH, createSttRelay, type RelayDeps, type RelaySession } from './sttRelay';

const SESSION_ID = '7f1c2a9e-3b4d-4c5e-8f60-1a2b3c4d5e6f';

function activeSession(overrides: Partial<RelaySession> = {}): RelaySession {
  const now = new Date().toISOString();
  return {
    id: SESSION_ID,
    user_id: 'user-1',
    status: 'active',
    started_at: now,
    metadata: { last_heartbeat_at: now, consent_status: 'granted' },
    ...overrides,
  };
}

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type Upstream = { socket: WebSocket; headers: IncomingHttpHeaders; received: Array<{ binary: boolean; data: Buffer }> };

/** A fake Deepgram, the relay on a real HTTP server, and helpers to connect as a browser. */
async function startHarness(overrides: Partial<RelayDeps> = {}) {
  const deepgram = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => deepgram.once('listening', resolve));
  const deepgramPort = (deepgram.address() as AddressInfo).port;
  const upstreams: Upstream[] = [];
  deepgram.on('connection', (socket, req) => {
    const upstream: Upstream = { socket, headers: req.headers, received: [] };
    upstreams.push(upstream);
    socket.on('message', (data, binary) => {
      upstream.received.push({ binary, data: Buffer.from(data as Buffer) });
      if (!binary && JSON.parse(data.toString()).type === 'CloseStream') {
        socket.send(JSON.stringify({ type: 'Results', is_final: true, channel_index: [1, 2], channel: { alternatives: [{ transcript: 'Last words.' }] } }));
        socket.close(1000);
      }
    });
  });

  const relay = createSttRelay({
    authenticate: async (req) => (req.headers.cookie?.includes('sb=valid') ? 'user-1' : null),
    loadSession: async () => activeSession(),
    remainingMinutes: async () => 30,
    openUpstream: () =>
      new WebSocket(`ws://127.0.0.1:${deepgramPort}/v1/listen?channels=2`, { headers: { Authorization: 'Token test-key' } }),
    ...overrides,
  });
  const server = createServer((_req, res) => res.end());
  server.on('upgrade', (req, socket, head) => void relay.handleUpgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const clients: WebSocket[] = [];

  function connect({ cookie = 'sb=valid', origin = `http://127.0.0.1:${port}`, session = SESSION_ID } = {}) {
    const client = new WebSocket(`ws://127.0.0.1:${port}${STT_STREAM_PATH}?session=${session}`, { headers: { cookie, origin } });
    const messages: string[] = [];
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      client.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    client.on('message', (data) => messages.push(data.toString()));
    client.on('error', () => undefined);
    clients.push(client);
    const opened = new Promise<void>((resolve) => client.once('open', () => resolve()));
    return { client, messages, closed, opened };
  }

  async function stop() {
    clients.forEach((client) => client.terminate());
    relay.close();
    await new Promise((resolve) => deepgram.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }

  return { connect, upstreams, relay, stop };
}

let harness: Awaited<ReturnType<typeof startHarness>> | null = null;

afterEach(async () => {
  await harness?.stop();
  harness = null;
});

describe('STT relay', () => {
  it('opens Deepgram with the server key and pipes audio and allowed controls only', async () => {
    harness = await startHarness();
    const { client, messages, opened } = harness.connect();
    await opened;

    expect(harness.upstreams).toHaveLength(1);
    expect(harness.upstreams[0].headers.authorization).toBe('Token test-key');

    client.send(Buffer.alloc(3200, 1));
    client.send(Buffer.alloc(3201, 1)); // not PCM16: dropped
    client.send(JSON.stringify({ type: 'Finalize' }));
    client.send(JSON.stringify({ type: 'Configure', model: 'something-expensive' })); // not allowed: dropped
    client.send('not json');
    await waitFor(() => harness!.upstreams[0].received.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const received = harness.upstreams[0].received;
    expect(received.map((m) => (m.binary ? `audio:${m.data.length}` : m.data.toString()))).toEqual([
      'audio:3200',
      '{"type":"Finalize"}',
    ]);

    harness.upstreams[0].socket.send(JSON.stringify({ type: 'Results', channel_index: [1, 2] }));
    await waitFor(() => messages.length === 1);
    expect(JSON.parse(messages[0])).toEqual({ type: 'Results', channel_index: [1, 2] });
  });

  it.each([
    ['signed out', { cookie: 'other=1' }, {}, RELAY_CLOSE.unauthorized],
    ['another site', { origin: 'https://evil.example' }, {}, RELAY_CLOSE.badRequest],
    ['a malformed session id', { session: 'nope' }, {}, RELAY_CLOSE.badRequest],
    ["someone else's session", {}, { loadSession: async () => activeSession({ user_id: 'user-2' }) }, RELAY_CLOSE.sessionNotFound],
    ['a stopped session', {}, { loadSession: async () => activeSession({ status: 'stopped' }) }, RELAY_CLOSE.sessionEnded],
    ['no minutes left', {}, { remainingMinutes: async () => 0 }, RELAY_CLOSE.quotaExceeded],
    ['a server without keys', {}, { configured: false }, RELAY_CLOSE.notConfigured],
  ] as Array<[string, Record<string, string>, Partial<RelayDeps>, number]>)(
    'refuses %s with a close code the browser can read, without opening Deepgram',
    async (_label, connectOptions, deps, code) => {
      harness = await startHarness(deps);
      const { closed } = harness.connect(connectOptions);
      expect((await closed).code).toBe(code);
      expect(harness.upstreams).toHaveLength(0);
    },
  );

  it('reports Deepgram being unreachable as retryable', async () => {
    harness = await startHarness({
      openUpstream: () => new WebSocket('ws://127.0.0.1:9/unreachable'),
    });
    const { closed } = harness.connect();
    expect((await closed).code).toBe(RELAY_CLOSE.upstreamFailed);
  });

  it('closes the stream when the session ends mid-call', async () => {
    let status = 'active';
    harness = await startHarness({
      loadSession: async () => activeSession({ status }),
      sessionCheckMs: 30,
    });
    const { closed, opened } = harness.connect();
    await opened;
    status = 'stopped';

    expect((await closed).code).toBe(RELAY_CLOSE.sessionEnded);
    await waitFor(() => harness!.upstreams[0].socket.readyState === WebSocket.CLOSED);
    expect(harness.relay.activeStreams()).toBe(0);
  });

  it('closes the stream when the minutes run out mid-call', async () => {
    let remaining = 30;
    harness = await startHarness({ remainingMinutes: async () => remaining, quotaCheckMs: 30 });
    const { closed, opened } = harness.connect();
    await opened;
    remaining = 0;

    expect((await closed).code).toBe(RELAY_CLOSE.quotaExceeded);
  });

  it('rides out a failed check but gives up after three in a row', async () => {
    let calls = 0;
    harness = await startHarness({
      loadSession: async () => {
        calls += 1;
        if (calls > 1) throw new Error('db unavailable');
        return activeSession();
      },
      sessionCheckMs: 30,
    });
    const { closed, opened } = harness.connect();
    await opened;

    expect((await closed).code).toBe(RELAY_CLOSE.upstreamFailed);
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  it('closes Deepgram as soon as the browser goes away', async () => {
    harness = await startHarness();
    const { client, opened } = harness.connect();
    await opened;
    client.terminate();

    await waitFor(() => harness!.upstreams[0].socket.readyState === WebSocket.CLOSED);
  });

  it('delivers the last results after CloseStream, then closes normally', async () => {
    harness = await startHarness();
    const { client, messages, closed, opened } = harness.connect();
    await opened;
    client.send(JSON.stringify({ type: 'CloseStream' }));

    expect((await closed).code).toBe(1000);
    expect(messages.map((m) => JSON.parse(m).channel?.alternatives?.[0]?.transcript)).toEqual(['Last words.']);
  });

  it('keeps one stream per session: a newer connection replaces the older one', async () => {
    harness = await startHarness();
    const first = harness.connect();
    await first.opened;
    const second = harness.connect();
    await second.opened;

    expect((await first.closed).code).toBe(RELAY_CLOSE.replaced);
    expect(second.client.readyState).toBe(WebSocket.OPEN);
    expect(harness.relay.activeStreams()).toBe(1);
  });

  it('rate-limits reconnect storms per user', async () => {
    harness = await startHarness({ connectsPerMinute: 2 });
    await harness.connect().opened;
    await harness.connect().opened;
    const third = harness.connect();
    expect((await third.closed).code).toBe(RELAY_CLOSE.rateLimited);
  });
});
