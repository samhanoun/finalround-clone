import {
  getBillableMinutes,
  getCopilotQuotaSnapshot,
  getElapsedUsage,
  recordCopilotUsage,
  type CopilotQuotaSnapshot,
} from '@/lib/copilot';
import { getSessionHeartbeatAt, isSessionHeartbeatExpired } from '@/lib/copilotSession';
import { createAdminClient } from '@/lib/supabase/admin';

export const SESSION_COLUMNS =
  'id, user_id, interview_session_id, title, metadata, status, started_at, stopped_at, duration_seconds, consumed_minutes, created_at, updated_at';

export type EndableCopilotSession = {
  id: string;
  user_id: string;
  status: string;
  started_at: string;
  metadata: Record<string, unknown> | null;
};

export type EndedCopilotSession = {
  /** The updated row, or null when another request ended the session first. */
  session: Record<string, unknown> | null;
  usage: { elapsedSeconds: number; elapsedMinutes: number };
  billableMinutes: number;
  quota: CopilotQuotaSnapshot;
};

/**
 * Ends an active copilot session and charges the minutes it ran.
 *
 * - Bills up to `endedAt` while the app is still sending heartbeats, and up
 *   to the last heartbeat once they have stopped (always the case for
 *   "expired"): that is the last moment the app was running.
 * - Writes with the service role: users can't change a session's status or
 *   usage themselves (migration 0028).
 * - Charges only when this call is the one that ended the session, so two
 *   requests noticing the same expiry can't bill it twice.
 */
export async function endCopilotSession(
  session: EndableCopilotSession,
  options: {
    status: 'stopped' | 'expired';
    endedAt?: Date;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ended: EndedCopilotSession; error: null } | { ended: null; error: { message: string; code?: string } }> {
  const endedAt = options.endedAt ?? new Date();
  // Once the heartbeat has lapsed nothing was running, even if a Stop only
  // arrives later (a laptop waking up): bill up to the last heartbeat.
  const billedUntil =
    options.status === 'expired' || isSessionHeartbeatExpired(session, endedAt.getTime())
      ? new Date(Math.min(getSessionHeartbeatAt(session).getTime(), endedAt.getTime()))
      : endedAt;

  const usage = getElapsedUsage(session.started_at, billedUntil);
  const quota = await getCopilotQuotaSnapshot(session.user_id);
  const billableMinutes = getBillableMinutes(usage.elapsedMinutes, quota);

  const { data, error } = await createAdminClient()
    .from('copilot_sessions')
    .update({
      status: options.status,
      stopped_at: endedAt.toISOString(),
      duration_seconds: usage.elapsedSeconds,
      consumed_minutes: billableMinutes,
      metadata: {
        ...(typeof session.metadata === 'object' && session.metadata !== null ? session.metadata : {}),
        ...(options.metadata ?? {}),
        quota_snapshot: quota,
        requested_minutes: usage.elapsedMinutes,
        billed_until: billedUntil.toISOString(),
      },
    })
    .eq('id', session.id)
    .eq('user_id', session.user_id)
    .eq('status', 'active')
    .select(SESSION_COLUMNS)
    .maybeSingle();

  if (error) return { ended: null, error };
  if (data) await recordCopilotUsage(session.user_id, billableMinutes);

  return { ended: { session: data, usage, billableMinutes, quota }, error: null };
}

/**
 * Ends every active session the user still has, before a new one starts.
 * A session whose app went away (no heartbeat) is billed up to its last
 * heartbeat; one still running elsewhere is stopped and billed up to now.
 * Without this, an abandoned session would never be charged.
 */
export async function endOpenCopilotSessions(sessions: EndableCopilotSession[], endedAt = new Date()) {
  for (const session of sessions) {
    if (session.status !== 'active') continue;
    const expired = isSessionHeartbeatExpired(session, endedAt.getTime());
    const { error } = await endCopilotSession(session, {
      status: expired ? 'expired' : 'stopped',
      endedAt,
      metadata: expired ? { expired_reason: 'heartbeat_timeout' } : { stop_reason: 'replaced_by_new_session' },
    });
    if (error) return { error };
  }
  return { error: null };
}
