/**
 * Shared between the STT relay (src/server/sttRelay.ts) and the browser
 * client (deepgramLive.ts). No imports, so both sides can use it.
 */

export const STT_STREAM_PATH = '/api/stt/stream';

/** WebSocket close codes the relay uses to say why a stream ended. */
export const RELAY_CLOSE = {
  /** Another tab or window took over this session's stream. */
  replaced: 4000,
  badRequest: 4400,
  unauthorized: 4401,
  quotaExceeded: 4403,
  sessionNotFound: 4404,
  sessionEnded: 4409,
  rateLimited: 4429,
  /** Deepgram or our checks failed; reconnecting may work. */
  upstreamFailed: 4502,
  notConfigured: 4503,
} as const;

/** Codes after which reconnecting can't help, with what to tell the user. */
export const FATAL_CLOSE_MESSAGES: Record<number, string> = {
  [RELAY_CLOSE.replaced]: 'Live transcription moved to another tab or window.',
  [RELAY_CLOSE.badRequest]: 'Live transcription refused the connection (bad request).',
  [RELAY_CLOSE.unauthorized]: 'You were signed out. Sign in again to keep transcribing.',
  [RELAY_CLOSE.quotaExceeded]: 'You have used all your copilot minutes for now.',
  [RELAY_CLOSE.sessionNotFound]: 'This copilot session no longer exists.',
  [RELAY_CLOSE.sessionEnded]: 'This copilot session has ended or expired.',
  [RELAY_CLOSE.notConfigured]: 'Live transcription is not set up on the server (DEEPGRAM_API_KEY or SUPABASE_SERVICE_ROLE_KEY is missing).',
};

/** The relay URL for a session, on the page's own host. */
export function sttStreamUrl(sessionId: string, location: Pick<Location, 'protocol' | 'host'>): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}${STT_STREAM_PATH}?session=${encodeURIComponent(sessionId)}`;
}
