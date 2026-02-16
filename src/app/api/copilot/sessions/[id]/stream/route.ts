import { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';

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

function sse(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, payload })}\n\n`;
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sse('connected', { sessionId: id })));

      const sent = new Set<string>();
      let keepRunning = true;

      req.signal.addEventListener('abort', () => {
        keepRunning = false;
      });

      while (keepRunning) {
        const [{ data: currentSession }, { data: events }] = await Promise.all([
          supabase
            .from('copilot_sessions')
            .select('id, status, title, started_at, stopped_at, consumed_minutes')
            .eq('id', id)
            .maybeSingle<Pick<SessionRow, 'id' | 'status' | 'title' | 'started_at' | 'stopped_at' | 'consumed_minutes'>>(),
          supabase
            .from('copilot_events')
            .select('id, event_type, payload, created_at')
            .eq('session_id', id)
            .order('created_at', { ascending: true })
            .limit(300)
            .returns<EventRow[]>(),
        ]);

        if (!currentSession) {
          controller.enqueue(encoder.encode(sse('session', { ...session, status: 'expired' })));
          break;
        }

        controller.enqueue(
          encoder.encode(
            sse('snapshot', {
              session: currentSession,
              events: events ?? [],
            }),
          ),
        );

        for (const row of events ?? []) {
          if (sent.has(row.id)) continue;
          sent.add(row.id);
          controller.enqueue(encoder.encode(sse('copilot_event', row)));
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
