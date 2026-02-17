export type CopilotErrorPayload = {
  error?: string;
  extra?: {
    requestId?: string;
    message?: string;
  };
};

const COPILOT_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Too many requests right now. Please wait a moment and try again.',
  unauthorized: 'Your session expired. Please sign in again.',
  session_active: 'Stop active sessions before deleting copilot data.',
  invalid_confirmation: 'Confirmation phrase does not match. Please type it exactly.',
  session_not_found: 'Session no longer exists or you no longer have access to it.',
  session_expired: 'This copilot session has expired. Start a new session to continue.',
  confirmation_user_mismatch: 'Confirmation details do not match your account.',
};

export function formatCopilotActionError(payload: CopilotErrorPayload | null, fallback: string): string {
  const code = payload?.error?.trim();
  if (!code) return fallback;

  const fromMap = COPILOT_ERROR_MESSAGES[code];
  if (fromMap) return fromMap;

  if (code === 'internal_error') {
    const requestId = payload?.extra?.requestId;
    return requestId ? `Something went wrong on our side. Reference: ${requestId}` : 'Something went wrong on our side. Please try again.';
  }

  return fallback;
}
