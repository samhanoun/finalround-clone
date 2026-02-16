import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { isSessionHeartbeatExpired, withHeartbeatMetadata } from '@/lib/copilotSession';
import { buildEventCursor, filterEventsAfterCursor, parseEventCursor } from '@/lib/copilotStreamCursor';

interface Params {
  params: Promise<{ id: string }>;
}

type SessionRow = {
  id: string;
  user_id: string;
  interview_session_id: string | null;
  title: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number;
  consumed_minutes: number;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const POLL_MS = 1500;

function sse(event: string, payload: unknown, id?: string) {
  const prefix = id ? `id: ${id}\n` : '';
  return `${prefix}event: ${event}\ndata: ${JSON.stringify({ type: event, payload })}\n\n`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:stream:${ip}`, limit: 180, windowMs: 60_000 });
  if (!rl.ok) return jsonError(429, 'rate_limited');

  const { id } = await params;
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, interview_session_id, title, metadata, status, started_at, stopped_at, duration_seconds, consumed_minutes, created_at, updated_at')
    .eq('id', id)
    .single<SessionRow>();

  if (sessionError || !session) return jsonError(404, 'session_not_found');
  if (session.user_id !== userData.user.id) return jsonError(403, 'forbidden');

  const encoder = new TextEncoder();
  const resumeCursor = parseEventCursor(req.headers.get('last-event-id'));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sse('connected', { sessionId: id })));

      let keepRunning = true;
      let cursor = resumeCursor;

      req.signal.addEventListener('abort', () => {
        keepRunning = false;
      });

      while (keepRunning) {
        const { data: currentSession } = await supabase
          .from('copilot_sessions')
          .select('id, status, title, started_at, stopped_at, consumed_minutes, metadata')
          .eq('id', id)
          .maybeSingle<Pick<SessionRow, 'id' | 'status' | 'title' | 'started_at' | 'stopped_at' | 'consumed_minutes' | 'metadata'>>();

        if (!currentSession) {
          controller.enqueue(encoder.encode(sse('session', { ...session, status: 'expired' })));
          break;
        }

        if (isSessionHeartbeatExpired(currentSession)) {
          const nowIso = new Date().toISOString();

          const { data: expiredSession } = await supabase
            .from('copilot_sessions')
            .update({
              status: 'expired',
              stopped_at: nowIso,
              metadata: {
                ...withHeartbeatMetadata(currentSession.metadata, nowIso),
                expired_reason: 'heartbeat_timeout',
              },
            })
            .eq('id', id)
            .eq('user_id', userData.user.id)
            .eq('status', 'active')
            .select('id, status, title, started_at, stopped_at, consumed_minutes, metadata')
            .maybeSingle<Pick<SessionRow, 'id' | 'status' | 'title' | 'started_at' | 'stopped_at' | 'consumed_minutes' | 'metadata'>>();

          const payload = expiredSession ?? { ...currentSession, status: 'expired', stopped_at: nowIso };
          controller.enqueue(encoder.encode(sse('session', payload)));
          break;
        }

        let eventQuery = supabase
          .from('copilot_events')
          .select('id, event_type, payload, created_at')
          .eq('session_id', id)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(300);

        if (cursor) {
          eventQuery = eventQuery.gte('created_at', cursor.createdAt);
        }

        const { data: events } = await eventQuery.returns<EventRow[]>();
        const nextEvents = filterEventsAfterCursor(events ?? [], cursor);

        if (!cursor) {
          controller.enqueue(
            encoder.encode(
              sse('snapshot', {
                session: currentSession,
                events: events ?? [],
              }),
            ),
          );
        }

        for (const row of nextEvents) {
          const eventCursor = buildEventCursor(row.created_at, row.id);
          cursor = { createdAt: row.created_at, id: row.id };
          controller.enqueue(encoder.encode(sse('copilot_event', row, eventCursor)));
        }

        controller.enqueue(encoder.encode(sse('session', currentSession)));

        if (currentSession.status !== 'active') {
          break;
        }

        await sleep(POLL_MS);
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
