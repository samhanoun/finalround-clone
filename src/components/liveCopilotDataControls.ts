export type CopilotErrorPayload = {
  error?: string;
  extra?: {
    requestId?: string;
    message?: string;
  };
};

/** A next-intl translator for the CopilotErrors messages. */
export type CopilotErrorTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

/** Turns an API error code into the user's language; unknown codes get `fallback`. */
export function formatCopilotActionError(
  payload: CopilotErrorPayload | null,
  fallback: string,
  t: CopilotErrorTranslator,
): string {
  const code = payload?.error?.trim();
  if (!code) return fallback;

  if (code === 'internal_error') {
    const requestId = payload?.extra?.requestId;
    return requestId ? t('internalWithReference', { reference: requestId }) : t('internal');
  }
  return t.has(code) ? t(code) : fallback;
}
