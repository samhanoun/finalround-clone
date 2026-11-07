import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runScheduledNotifications } from '@/lib/notificationJobs';

/**
 * Sends due reminders and weekly digests (src/lib/notificationJobs.ts).
 * The custom server calls it every 5 minutes with its own secret; an external
 * scheduler can call it with `Authorization: Bearer <CRON_SECRET>`.
 */

function matches(given: string, expected: string | undefined): boolean {
  if (!expected || expected.length < 32) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(req: NextRequest) {
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!matches(given, process.env.CRON_SECRET) && !matches(given, process.env.INTERNAL_CRON_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  try {
    const sent = await runScheduledNotifications();
    return NextResponse.json({ ok: true, sent });
  } catch (error) {
    console.error('[cron] notifications failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
