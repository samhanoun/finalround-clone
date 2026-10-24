import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { LATENCY_STAGES } from '@/lib/copilot/latency';
import { QUESTION_CATEGORIES, type QuestionCategory } from '@/lib/copilot/questionGate';

/**
 * POST /api/copilot/sessions/[id]/latency — stores how long each answered
 * question took, stage by stage (durations measured in the browser). Saved as
 * `system` events with `payload.kind = 'latency'`; the stop route and the
 * history view turn them into p50/p95 per stage.
 */

interface Params {
  params: Promise<{ id: string }>;
}

const duration = z.number().int().min(0).max(600_000).nullable();

const TurnSchema = z.object({
  ...Object.fromEntries(LATENCY_STAGES.map((stage) => [stage, duration])),
  category: z.enum(QUESTION_CATEGORIES as [QuestionCategory, ...QuestionCategory[]]),
  trigger: z.enum(['gate', 'manual']),
  via: z.string().max(20),
  outcome: z.enum(['answered', 'superseded', 'stopped', 'error']),
  server_ttft_ms: duration,
});

const BodySchema = z.object({ turns: z.array(TurnSchema).min(1).max(20) });

export async function POST(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ipRl = await rateLimit({ key: `copilot:latency:ip:${ip}`, limit: 120, windowMs: 60_000 });
  if (!ipRl.ok) return jsonError(429, 'rate_limited');

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  const userRl = await rateLimit({ key: `copilot:latency:user:${userId}`, limit: 120, windowMs: 60_000 });
  if (!userRl.ok) return jsonError(429, 'rate_limited');

  // Any status: the last answer of a session can finish just after it stops.
  const { data: session } = await supabase
    .from('copilot_sessions')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle<{ id: string; user_id: string }>();
  if (!session || session.user_id !== userId) return jsonError(404, 'session_not_found');

  const { error } = await supabase.from('copilot_events').insert(
    parse.data.turns.map((turn) => ({
      session_id: id,
      user_id: userId,
      event_type: 'system',
      payload: { kind: 'latency', ...turn },
    })),
  );
  if (error) {
    console.error('[copilot]', { route: '/api/copilot/sessions/[id]/latency', errorClass: 'db_insert_failed', code: error.code ?? null });
    return jsonError(500, 'internal_error');
  }

  return NextResponse.json({ accepted: parse.data.turns.length }, { status: 201 });
}
