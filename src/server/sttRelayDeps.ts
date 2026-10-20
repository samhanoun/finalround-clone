import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import { buildDeepgramListenUrl } from '../lib/stt/deepgramListenUrl';
import type { RelayDeps, RelaySession } from './sttRelay';

const QUOTA_COUNTERS = ['copilot_minutes', 'copilot_daily_minutes', 'copilot_session_minutes'] as const;

/** The relay's real dependencies: Supabase for who/what/how much, Deepgram for transcription. */
export function relayDepsFromEnv(env: NodeJS.ProcessEnv = process.env): RelayDeps {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const deepgramKey = env.DEEPGRAM_API_KEY ?? '';

  let admin: SupabaseClient | null = null;
  const adminClient = () =>
    (admin ??= createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));

  return {
    configured: Boolean(supabaseUrl && anonKey && serviceKey && deepgramKey),
    allowedOrigins: env.NEXT_PUBLIC_APP_URL ? [new URL(env.NEXT_PUBLIC_APP_URL).origin] : [],

    async authenticate(req) {
      const supabase = createServerClient(supabaseUrl, anonKey, {
        cookies: {
          getAll: () =>
            parseCookieHeader(req.headers.cookie ?? '').map(({ name, value }) => ({ name, value: value ?? '' })),
          // A refreshed token can't be written back over a WebSocket; the page refreshes it.
          setAll: () => undefined,
        },
      });
      const { data, error } = await supabase.auth.getUser();
      return error || !data.user ? null : data.user.id;
    },

    async loadSession(sessionId) {
      const { data, error } = await adminClient()
        .from('copilot_sessions')
        .select('id, user_id, status, started_at, metadata')
        .eq('id', sessionId)
        .maybeSingle<RelaySession>();
      if (error) throw new Error(`load_session: ${error.message}`);
      return data;
    },

    async remainingMinutes(userId) {
      const results = await Promise.all(
        QUOTA_COUNTERS.map((counter) =>
          adminClient().rpc('check_quota', { p_user_id: userId, p_counter_type: counter }),
        ),
      );
      return Math.min(
        ...results.map(({ data, error }) => {
          if (error) throw new Error(`check_quota: ${error.message}`);
          const row = Array.isArray(data) ? (data[0] as { remaining?: unknown } | undefined) : undefined;
          return typeof row?.remaining === 'number' ? row.remaining : 0;
        }),
      );
    },

    openUpstream() {
      const url = buildDeepgramListenUrl({
        model: env.DEEPGRAM_MODEL,
        language: env.DEEPGRAM_LANGUAGE,
        // End-to-end tests point this at a local fake.
        endpoint: env.DEEPGRAM_LISTEN_URL || undefined,
      });
      return new WebSocket(url, { headers: { Authorization: `Token ${deepgramKey}` } });
    },

    log(event, meta) {
      console.log(JSON.stringify({ scope: 'stt-relay', event, ...meta }));
    },
  };
}
