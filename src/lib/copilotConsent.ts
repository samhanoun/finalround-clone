/**
 * Consent Gate — Enforce explicit user consent before any ingest/stream operation.
 *
 * PRD gap: T2 — Reject events/stream for non-active or non-consented sessions.
 * Adds consent audit fields and guards for revoke/stop race conditions.
 *
 * Consent is stored as flat metadata fields on the session row:
 *   metadata.consent_status: 'granted' | 'revoked' | 'pending' | 'expired'
 *   metadata.consent_granted_at: ISO string
 *   metadata.consent_revoked_at: ISO string (set on revoke)
 */

export type ConsentStatus = 'granted' | 'revoked' | 'pending' | 'expired';

export interface SessionConsentInfo {
  status: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Extract consent status from a session row.
 * Sessions created before consent gate adoption are treated as 'pending'.
 */
export function getConsentStatus(session: SessionConsentInfo): ConsentStatus {
  const raw =
    typeof session.metadata === 'object' && session.metadata !== null
      ? session.metadata.consent_status
      : undefined;

  if (raw === 'granted' || raw === 'revoked' || raw === 'pending' || raw === 'expired') {
    return raw;
  }
  return 'pending';
}

/**
 * Check whether the session allows ingestion of new events / stream data.
 *
 * Returns { allowed: true } or { allowed: false, reason }.
 * 
 * Order of checks: session status first, then consent status.
 */
export function checkIngestConsent(
  session: SessionConsentInfo,
): { allowed: true } | { allowed: false; reason: string } {
  // First check: session must be active
  if (session.status !== 'active') {
    return { allowed: false, reason: 'session_not_active' };
  }

  // Second check: consent must be granted
  const consent = getConsentStatus(session);

  if (consent === 'granted') {
    return { allowed: true };
  }

  // Return specific reason based on consent status
  if (consent === 'pending') {
    return { allowed: false, reason: 'consent_pending' };
  }
  if (consent === 'revoked') {
    return { allowed: false, reason: 'consent_revoked' };
  }
  if (consent === 'expired') {
    return { allowed: false, reason: 'consent_expired' };
  }

  return { allowed: false, reason: 'consent_required' };
}

/**
 * Build metadata patch that records consent grant with audit timestamp.
 */
export function grantConsentMetadata(
  existing: Record<string, unknown> | null | undefined,
  atIso: string,
): Record<string, unknown> {
  return {
    ...(typeof existing === 'object' && existing !== null ? existing : {}),
    consent_status: 'granted' as ConsentStatus,
    consent_granted_at: atIso,
  };
}

/**
 * Build metadata patch that records consent revocation.
 * After revoke, no further ingest should be allowed.
 */
export function revokeConsentMetadata(
  existing: Record<string, unknown> | null | undefined,
  atIso: string,
): Record<string, unknown> {
  return {
    ...(typeof existing === 'object' && existing !== null ? existing : {}),
    consent_status: 'revoked' as ConsentStatus,
    consent_revoked_at: atIso,
  };
}

/**
 * Validates that consent was granted before a specific action timestamp.
 * Prevents race: consent revoked at T1, but event arrives at T2 > T1.
 */
export function isConsentValidAt(
  session: SessionConsentInfo,
  actionIso: string,
): boolean {
  const consent = getConsentStatus(session);
  if (consent !== 'granted') return false;

  const revokedAt =
    typeof session.metadata === 'object' && session.metadata !== null
      ? session.metadata.consent_revoked_at
      : undefined;

  if (typeof revokedAt === 'string') {
    return new Date(actionIso).getTime() < new Date(revokedAt).getTime();
  }

  return true;
}
