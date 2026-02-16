type SessionStatus = 'active' | 'stopped' | 'expired' | string;

export type CopilotSessionHeartbeatShape = {
  status: SessionStatus;
  started_at: string;
  metadata?: Record<string, unknown> | null;
};

export const COPILOT_HEARTBEAT_TIMEOUT_MS = 60_000;

export function getSessionHeartbeatAt(session: CopilotSessionHeartbeatShape): Date {
  const heartbeatAt =
    typeof session.metadata?.last_heartbeat_at === 'string'
      ? session.metadata.last_heartbeat_at
      : typeof session.metadata?.created_at === 'string'
        ? session.metadata.created_at
        : session.started_at;

  const parsed = new Date(heartbeatAt);
  if (Number.isNaN(parsed.getTime())) return new Date(session.started_at);
  return parsed;
}

export function isSessionHeartbeatExpired(
  session: CopilotSessionHeartbeatShape,
  now = Date.now(),
  timeoutMs = COPILOT_HEARTBEAT_TIMEOUT_MS,
): boolean {
  if (session.status !== 'active') return false;
  const heartbeatAt = getSessionHeartbeatAt(session).getTime();
  return now - heartbeatAt > timeoutMs;
}

export function withHeartbeatMetadata(metadata: Record<string, unknown> | null | undefined, atIso: string) {
  return {
    ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
    last_heartbeat_at: atIso,
  };
}
