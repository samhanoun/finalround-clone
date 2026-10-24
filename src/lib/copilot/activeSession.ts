import type { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { checkIngestConsent } from '@/lib/copilotConsent';
import { isSessionHeartbeatExpired } from '@/lib/copilotSession';
import type { createClient } from '@/lib/supabase/server';

export type ActiveCopilotSession = {
  id: string;
  user_id: string;
  status: string;
  started_at: string;
  metadata: Record<string, unknown> | null;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Loads a copilot session for live work (answers, classifier): it must belong
 * to the user, be active with a fresh heartbeat, and have consent granted.
 * Someone else's session reads as not found.
 */
export async function loadActiveCopilotSession(
  supabase: SupabaseServerClient,
  sessionId: string,
  userId: string,
): Promise<{ session: ActiveCopilotSession; error: null } | { session: null; error: NextResponse }> {
  const { data: session, error } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, started_at, metadata')
    .eq('id', sessionId)
    .single<ActiveCopilotSession>();

  if (error || !session || session.user_id !== userId) {
    return { session: null, error: jsonError(404, 'session_not_found') };
  }
  if (session.status !== 'active') return { session: null, error: jsonError(409, 'session_not_active') };
  if (isSessionHeartbeatExpired(session)) return { session: null, error: jsonError(409, 'session_expired') };

  const consent = checkIngestConsent(session);
  if (!consent.allowed) return { session: null, error: jsonError(403, consent.reason) };

  return { session, error: null };
}

export function sessionMode(session: ActiveCopilotSession): string {
  return typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general';
}
