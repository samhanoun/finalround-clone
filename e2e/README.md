# End-to-end tests

## Live copilot loop (`copilot-live.spec.ts`)

Proves the whole loop in a real browser: Chromium's fake microphone plays an
interviewer, and the test follows it through capture → STT relay → transcript →
question gate → streamed answer, then the latency drawer and stopping the session.

```bash
npx playwright test -c playwright.live.config.ts
```

By default it runs against **local fakes** (`e2e/fakes/`), so it needs no keys:

- **Supabase:** auth plus the PostgREST calls the copilot makes, over in-memory tables, scoped by user like RLS.
- **Deepgram:** checks the server-side key and "hears" the scripted question once a second of interviewer audio arrives on channel 1.
- **OpenAI:** streams a scripted answer piece by piece.

It also checks what reached each service:
- Deepgram got the server's key, audio on the interviewer channel and silence on yours.
- The model got the context pack and the question.
- The database got the transcript, the answer and the latency row.

The app runs with `NEXT_PUBLIC_E2E_FAKE_AUDIO=1`, which routes the fake microphone to the
interviewer channel (development builds only), and builds into `.next-e2e` so it can run
beside `npm run dev`.

Locally, without Playwright's own browser you can use any Chromium:

```bash
CHROMIUM_PATH=/path/to/chrome npx playwright test -c playwright.live.config.ts
```

### Against real services

Set `E2E_REAL=1` and provide:

| Variable | What |
|---|---|
| `E2E_EMAIL`, `E2E_PASSWORD` | A test user in a **test** Supabase project, with copilot minutes available |
| `E2E_QUESTION_WAV` | A 16-bit PCM WAV of someone asking an interview question |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | That project |
| `DEEPGRAM_API_KEY`, `OPENAI_API_KEY` | Real keys (ideally capped, dedicated ones) |

In CI, the **E2E live loop** workflow runs the fakes version on every push and PR. Run it
manually with `real = true` to use the `E2E_*` repository secrets. That job generates the
question audio with Deepgram's text-to-speech.

## Other specs

`playwright.config.ts` runs the rest (`auth`, `copilot` signed-out checks, `interview`,
`resume`) against `npm run dev`.

## The whole app (`e2e/app`)

`playwright.app.config.ts` signs in as the fake user and goes through every page in
every language, every control on each page, and each feature flow (sign-in and
onboarding, the live copilot, practice, goals, the question bank, résumés, cover
letters, jobs, analytics, settings, support, teams, admin), on desktop and on a phone
(Pixel 7, the `@mobile` tests). It starts the fakes and the app itself, or uses
`E2E_BASE_URL` for an app already running against them:

```bash
npm run test:e2e:app
```

## The desktop app (`e2e/desktop`)

`playwright.desktop.config.ts` launches the desktop app (`desktop/`) through
Playwright's Electron support, showing the web app on the fakes: the page's bridge,
the window frame, Settings → Desktop app, the floating answer window, the navigation
lock and the page shown when the server doesn't answer. Build the desktop app first,
and don't run it at the same time as the whole-app suite on the same fakes (starting a
live session ends the fake user's other sessions):

```bash
npm --prefix desktop run build
npm run test:e2e:desktop
```
