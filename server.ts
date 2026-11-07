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

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import next from 'next';
import { STT_STREAM_PATH, createSttRelay } from './src/server/sttRelay';
import { relayDepsFromEnv } from './src/server/sttRelayDeps';

async function main() {
  const dev = !process.argv.includes('--production');
  const hostname = process.env.HOSTNAME ?? (dev ? 'localhost' : '0.0.0.0');
  const port = Number(process.env.PORT ?? 3000);

  // Lets this process call its own /api/cron/notifications (Next runs in-process, so it sees the same env).
  process.env.INTERNAL_CRON_SECRET = randomBytes(32).toString('hex');

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

  const scheduler = startNotificationScheduler(port);

  const shutdown = () => {
    clearInterval(scheduler);
    relay.close();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (${dev ? 'development' : 'production'}, STT relay at ${STT_STREAM_PATH})`);
  });
}

/**
 * Reminders and weekly digests (src/lib/notificationJobs.ts): every 5 minutes,
 * starting a minute after boot. Set NOTIFICATION_SCHEDULER=off to rely on an
 * external scheduler calling /api/cron/notifications with CRON_SECRET instead.
 */
function startNotificationScheduler(port: number): NodeJS.Timeout | undefined {
  if (process.env.NOTIFICATION_SCHEDULER === 'off' || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return undefined;
  const run = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cron/notifications`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.INTERNAL_CRON_SECRET}` },
      });
      if (!res.ok) console.warn(`[notifications] scheduled run failed: ${res.status}`);
    } catch (error) {
      console.warn('[notifications] scheduled run failed:', error instanceof Error ? error.message : error);
    }
  };
  setTimeout(() => void run(), 60_000).unref();
  const timer = setInterval(() => void run(), 5 * 60_000);
  timer.unref();
  return timer;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
