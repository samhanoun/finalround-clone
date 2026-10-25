// Shared settings for the end-to-end live-loop test and its fake services.
// CommonJS so both the Playwright config (transpiled) and the fakes (plain
// `node`) can load it without a build step.

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS on purpose (see above)
const path = require('node:path');

const PORTS = {
  app: Number(process.env.E2E_APP_PORT ?? 3100),
  supabase: Number(process.env.E2E_FAKE_SUPABASE_PORT ?? 54390),
  deepgram: Number(process.env.E2E_FAKE_DEEPGRAM_PORT ?? 54391),
  openai: Number(process.env.E2E_FAKE_OPENAI_PORT ?? 54392),
};

const KEYS = {
  anon: 'e2e-anon-key',
  service: 'e2e-service-role-key',
  deepgram: 'e2e-deepgram-key',
  openai: 'e2e-openai-key',
};

const USER = {
  id: '0e2e0000-0000-4000-8000-000000000001',
  email: 'e2e-candidate@example.test',
  password: 'e2e-password-not-secret',
};

const RESUME = {
  id: '0e2e0000-0000-4000-8000-0000000000aa',
  filename: 'e2e-resume.pdf',
  parsed_text: [
    'Staff engineer with 8 years in payments.',
    'Led the payments migration at Stripe, cutting checkout latency by 40%.',
    'Mentored four engineers and ran the on-call rotation.',
  ].join('\n'),
};

/** What the fake Deepgram "hears" once interviewer audio arrives. */
const QUESTION = 'Tell me about a time you led a project?';
const INTERIM = 'Tell me about a time';

/** What the fake model streams back, piece by piece. */
const ANSWER_PIECES = [
  'I led the payments migration at Stripe. ',
  '\n- Situation: checkout was slow and brittle.',
  '\n- Action: I planned the cut-over and ran it in stages.',
  '\n- Result: checkout latency dropped by 40%.',
];

const WAV_PATH = path.join(__dirname, '..', '.artifacts', 'interviewer-question.wav');

/** Environment for the app under test when it talks to the fakes. */
function fakeAppEnv() {
  return {
    PORT: String(PORTS.app),
    HOSTNAME: 'localhost',
    NEXT_DIST_DIR: '.next-e2e',
    NEXT_PUBLIC_APP_URL: `http://localhost:${PORTS.app}`,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PORTS.supabase}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: KEYS.anon,
    SUPABASE_SERVICE_ROLE_KEY: KEYS.service,
    NEXT_PUBLIC_BETA_LIVE_COPILOT: 'true',
    NEXT_PUBLIC_E2E_FAKE_AUDIO: '1',
    DEEPGRAM_API_KEY: KEYS.deepgram,
    DEEPGRAM_LISTEN_URL: `ws://127.0.0.1:${PORTS.deepgram}/v1/listen`,
    LLM_PROVIDER: 'openai',
    OPENAI_API_KEY: KEYS.openai,
    OPENAI_BASE_URL: `http://127.0.0.1:${PORTS.openai}/v1`,
  };
}

module.exports = { PORTS, KEYS, USER, RESUME, QUESTION, INTERIM, ANSWER_PIECES, WAV_PATH, fakeAppEnv };
