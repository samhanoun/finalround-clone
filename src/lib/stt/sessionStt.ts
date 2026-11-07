/**
 * Per-session speech settings, stored in copilot_sessions.metadata.stt by the
 * start route and read by the STT relay when it opens Deepgram:
 * - language: what the interview is spoken in ("multi" = English and Spanish
 *   mixed); null keeps the server default (DEEPGRAM_LANGUAGE);
 * - singleMic: phone / in-person mode, one microphone for both people, told
 *   apart by Deepgram's speaker diarization (see src/lib/stt/speakers.ts).
 * No path aliases: the custom server imports this through the relay.
 */

export const SPOKEN_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'multi'] as const;
export type SpokenLanguage = (typeof SPOKEN_LANGUAGES)[number];

export type SessionStt = { language: SpokenLanguage | null; singleMic: boolean };

export function isSpokenLanguage(value: unknown): value is SpokenLanguage {
  return typeof value === 'string' && (SPOKEN_LANGUAGES as readonly string[]).includes(value);
}

export function sessionStt(metadata: Record<string, unknown> | null | undefined): SessionStt {
  const stt = (metadata?.stt ?? {}) as { language?: unknown; singleMic?: unknown };
  return {
    language: isSpokenLanguage(stt.language) ? stt.language : null,
    singleMic: stt.singleMic === true,
  };
}
