/**
 * Custom Node server: Next.js plus the live speech-to-text relay on one port.
 *
 *   npm run dev     → development (Turbopack, hot reload)
 *   npm run start   → production, after `npm run build`
 *
 * Next.js route handlers can't accept WebSocket upgrades, so upgrades for
 * STT_STREAM_PATH go to the relay and everything else (including hot-reload
 * sockets) goes to Next. Compiled with `tsc -p tsconfig.server.json`.
 */

import { createServer } from 'node:http';
import next from 'next';
import { STT_STREAM_PATH, createSttRelay } from './src/server/sttRelay';
import { relayDepsFromEnv } from './src/server/sttRelayDeps';

async function main() {
  const dev = !process.argv.includes('--production');
  const hostname = process.env.HOSTNAME ?? (dev ? 'localhost' : '0.0.0.0');
  const port = Number(process.env.PORT ?? 3000);

  const app = next({ dev, turbopack: dev, hostname, port });
  const handle = app.getRequestHandler();
  // prepare() also loads .env / .env.local into process.env.
  await app.prepare();
  const nextUpgrade = app.getUpgradeHandler();

  const relayDeps = relayDepsFromEnv(process.env);
  if (!relayDeps.configured) {
    console.warn(
      '[stt-relay] Live transcription is off: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and DEEPGRAM_API_KEY.',
    );
  }
  const relay = createSttRelay(relayDeps);

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === STT_STREAM_PATH) void relay.handleUpgrade(req, socket, head);
    else void nextUpgrade(req, socket, head);
  });

  const shutdown = () => {
    relay.close();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (${dev ? 'development' : 'production'}, STT relay at ${STT_STREAM_PATH})`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
