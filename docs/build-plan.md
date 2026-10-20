# Apex Round: audit, gap analysis and build plan

*2026-10-19. Phases 2–3 of the RE → audit → plan task. Companion to [re-finalround-analysis.md](re-finalround-analysis.md).*

> **Status: plan only.** No application code was changed. Waiting for your go-ahead before implementation.

---

## Part A: Audit of this repo (Phase 2)

Repo audited: `C:\Users\harry\Documents\finalround-clone` @ `efc1cb5` (2026-02-19, identical to `origin/master`). Package `apex-round` 0.1.0, Next.js 16.1.6, React 19, Supabase, OpenAI. `EXECUTION_STATUS.md` and the README were **not** trusted; every status below comes from reading the code or running it.

### A.1 What I ran

| Check | Result |
|---|---|
| `npm ci` | ✅ 949 packages |
| `npx jest --ci` | ✅ 32 suites, 208 tests pass. All mock Supabase and OpenAI, so they prove route logic, not end-to-end behavior |
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx eslint .` | ✅ 0 errors, 66 warnings (unused vars) |
| `npx next build` (no env) | ❌ Fails at "Collecting page data": `SUPABASE_SERVICE_ROLE_KEY is required`, thrown at import time by [`src/lib/resumeParser.ts:5`](../src/lib/resumeParser.ts) (`const admin = createAdminClient()` at module scope) |
| `next dev` smoke run (no env, beta flag on) | `/api/health` 200 · `/` **404** · `/en` **500** · `/en/interview/abc` 500 · `/api/copilot/sessions/history` 500 · `/api/usage` 500, all with `Missing env var: NEXT_PUBLIC_SUPABASE_URL`. `/en/copilot/live`, `/en/dashboard` and `/en/auth` return 200 only for the streamed loading shell |
| Backend | Supabase project **"Finalroundy"** (`repgqysbgrjkcpzbyqpe`, eu-west-1) exists but is **INACTIVE (paused)**. No `.env.local`, no OpenAI or Deepgram key in the repo. **The app cannot run end to end today.** |
| Real Zoom/Meet call | Not run: blocked by the paused backend. Also not needed for the verdict, because the code shows it cannot hear the interviewer (A.3). |

`EXECUTION_STATUS.md` says "All modules verified working end-to-end", "154 unit tests passing" and "Production build successful". None of that holds as stated.

### A.2 Module status

| Module | Status | Works end to end? | Evidence |
|---|---|---|---|
| **Live copilot** | 🟠 Partial | **No** (see A.3) | Mic-only Web Speech API ([`LiveCopilotClient.tsx:866-930`](../src/components/LiveCopilotClient.tsx)); per-line non-streamed `gpt-4o-mini` call ([`transcript/route.ts`](../src/app/api/copilot/sessions/[id]/transcript/route.ts)); SSE that polls Postgres every 1.5 s ([`stream/route.ts`](../src/app/api/copilot/sessions/[id]/stream/route.ts) `POLL_MS`). Hidden behind `NEXT_PUBLIC_BETA_LIVE_COPILOT`. Session lifecycle, heartbeat, consent, retention, export and purge exist and are unit-tested. |
| **Coding copilot** | 🔴 Missing | No | Only a `mode === 'coding'` prompt variant in [`copilotSuggestion.ts`](../src/lib/copilotSuggestion.ts). No screen capture, no vision call. |
| **Mock interviews** | 🟠 Partial | No | [`interviews/[id]/messages`](../src/app/api/interviews/[id]/messages/route.ts) only **stores** the user's message; nothing generates an interviewer reply or questions. Feedback and score save, and the LLM report ([`interviews/[id]/report`](../src/app/api/interviews/[id]/report/route.ts)) works with env. Each message is also charged against **copilot** minute quotas (a wiring bug). |
| **Resume** | 🟡 Mostly works (with env) | Partly | Upload to Supabase Storage, PDF/DOCX parsing ([`resumeParser.ts`](../src/lib/resumeParser.ts)), ATS score and keywords (heuristic, [`atsScoring.ts`](../src/lib/atsScoring.ts)), bullet rewrite (heuristic, `bulletRewriter`), versions, download. ❌ "Generate / deep review" inserts a `queued` row in `resume_generations` and **nothing ever processes it**. ❌ Module-scope admin client breaks `next build`. |
| **Job hunter** | 🟡 Basic | Yes (as a tracker) | [`JobsClient.tsx`](../src/components/JobsClient.tsx) is manual CRUD on `job_applications` from the browser. No job search, matching or auto-apply. Dashboard "applications submitted" is hardcoded to 0 ([`DashboardStats.tsx:35-40`](../src/components/DashboardStats.tsx)). |
| **Analytics** | 🟠 Partial / mock | No | Funnel and reports return **mock data** ([`analytics/funnel/route.ts:30`](../src/app/api/analytics/funnel/route.ts), [`analytics/reports/route.ts:31`](../src/app/api/analytics/reports/route.ts)); admin MRR placeholder ([`admin/analytics/route.ts:104`](../src/app/api/admin/analytics/route.ts)). Usage widget reads real quota tables. |
| **Billing** | 🟠 Partial | No | Stripe **webhook** sync and plan quotas exist ([`webhooks/stripe`](../src/app/api/webhooks/stripe/route.ts), [`quota.ts`](../src/lib/quota.ts), migrations 0003–0005, 0008). **No Checkout or Billing-Portal route anywhere**, so nobody can pay. |
| **Chrome extension** | 🔴 Shell | No | No audio capture (no `tabCapture`/`offscreen`); **no network calls** to the app; `SHOW_SUGGESTION` is handled but never sent. Its overlay is injected **into the meeting page's DOM**, so it shows up when that tab is shared. Requests `<all_urls>`. |
| Auth / onboarding / settings | 🟡 Likely works (with env) | Unverified | Supabase SSR auth in [`middleware.ts`](../middleware.ts). Couldn't be exercised with the project paused. |
| Cover letters | 🟡 Works (with env) | Unverified | [`coverLetter.ts`](../src/lib/coverLetter.ts) → `gpt-4o-mini`. |
| LLM router | 🟡 Exists, bypassed | — | [`llmRouter.ts`](../src/lib/llmRouter.ts) supports OpenAI, Anthropic and Gemini with fallback, but the three copilot routes hardcode OpenAI and return 400 `unsupported_provider` unless `LLM_PROVIDER=openai`. |
| Teams/SSO, admin, video conferencing, scheduling, integrations, social/referrals, push, i18n (5 locales) | 🟠 Scaffolding | Mostly no | e.g. team invitations `TODO: Send invitation email`; SSO "Coming soon". |
| DB migrations | ⚠️ Risk | — | Duplicate version prefixes: `0008_*` ×2, `0009_*` ×3, `0010_*` ×2, `0015_*` ×2. The Supabase CLI keys migrations by version prefix, so this will likely collide on `supabase db push` (🔶 verify with `--dry-run`). |
| Dead code | — | — | [`src/lib/sttProviders/*`](../src/lib/sttProviders) (Deepgram pre-recorded REST, Whisper) is imported **only by tests**. |

### A.3 Does the live copilot work in a real Zoom/Meet call? **No.**

1. **It can't hear the interviewer.** The only audio path is `webkitSpeechRecognition` on the **microphone**. Interviewers come through the meeting app's speaker output, which nothing captures. With headphones (the normal setup) the transcript stays empty.
2. **Speaker labels are manual.** Every mic line gets the dropdown's single label (`draftSpeaker`). Labeled "candidate", it never triggers suggestions (`autoSuggest` only fires for `interviewer`). Labeled "interviewer", your own speech triggers them too.
3. **It silently stops.** `recognition.onend` sets `listening=false` and doesn't restart; Chrome ends continuous recognition after silence or network hiccups. It's also Chrome-only, `en-US` only, and audio goes to Google's speech service.
4. **No question detection.** Every final "interviewer" line becomes one LLM call.
5. **Slow by construction** (🔶 estimate): browser final (~0.5–1.5 s) + 450 ms batch debounce + full non-streamed JSON completion (~1.5–4 s) + DB insert + up to 1.5 s SSE poll ⇒ roughly **3–7 s** before anything shows, all at once, with no streaming.
6. **No context.** The prompt sees only the last 16 transcript lines and a mode hint: no resume, no job description, no company or role.
7. **Wrong surface.** Answers render in the same browser tab as the app. When you switch to the meeting, they're out of view, and the extension overlay lives inside the shared meeting tab.

---

## Part B: Gap analysis, Final Round AI vs Apex Round

| Capability | Final Round AI (v3.0.5 desktop) | Apex Round today | Gap |
|---|---|---|---|
| Platform | Electron app, Win + Mac | Next.js page (Chrome), beta flag | Large |
| Interviewer audio | Native system-audio loopback (WASAPI / Core Audio Taps) | **None** | **Blocker** |
| Candidate audio | Native mic stream, role by source | Web Speech API, manual label | Large |
| STT | Server-side streaming STT, interim + final, `finalize` | Browser Web Speech (Google), finals only; Deepgram/Whisper code unused | Large |
| VAD / endpointing | Silero client VAD + explicit finalize | Browser default | Medium |
| Transport | 1 WebSocket: binary audio up, typed frames down, seq + resume | HTTP POST batches + SSE polling DB every 1.5 s | Large |
| Question detection | Server "gate" classifier + "Answer anyway" | Every final interviewer line | Large |
| Answer generation | Token-streamed, supersede in-flight | Non-streamed JSON `gpt-4o-mini`, no cancel | Large |
| Context | Goal (company/role) + resume + materials via RAG + memory + playbooks | Last 16 transcript lines | Large |
| Model choice | Server `model-list` | Hardcoded `gpt-4o-mini`; router bypassed | Small |
| Answer window | Transparent always-on-top overlays, hotkeys move/resize | In-page panel | Large |
| Hidden from screen share | `setContentProtection` on all windows | None | Product decision (see Part E) |
| Coding copilot | Hotkey screenshot → signed upload → server vision → structured result + code artifacts | Prompt variant only | Large |
| Phone / in-person mode | Single mic + voice-sample-anchored diarization | None | Medium (post-MVP) |
| Mock interviews | Backend-driven interviewer + Tavus video avatar | Message log, no AI interviewer; LLM report ✅ | Large (post-MVP) |
| Reports / debriefs | `v3/reports`, transcript analysis | Copilot summarize ✅, interview report ✅ | Small |
| Resume / documents | Documents + parsed profiles feed RAG | Upload/parse/ATS ✅; generate ✗ | Small for MVP |
| Memory / playbooks | Yes | No | Post-MVP |
| Auth | Clerk OAuth + PKCE, deep link | Supabase auth | None for web MVP |
| Billing | Stripe checkout + subscription | Webhook only, no checkout | Medium (needed only to charge) |
| Resilience | Reconnect, 12 s audio ring buffer, heartbeat | Session heartbeat/expiry only | Medium |
| Telemetry | Sentry + PostHog, per-verdict latency | Basic SLO client | Small |

---

## Part C: The smallest MVP that's genuinely usable in a real interview

### C.1 Definition

> In **Chrome**, during a real **Google Meet, Zoom web or Teams web** call, Apex Round hears **both** the interviewer and you, shows a live transcript, detects when a question has been asked (or you press **Answer now**), and **streams** a short, first-person answer **grounded in your resume and the job description** into an always-on-top window. The first words should appear in **≤ 1.5 s (p50)** after the interviewer stops talking, and capture should survive a 60-minute call.

Chosen approach: **web-first**, reusing this repo. A desktop app is the next phase, not the MVP.

| Option | Pros | Cons |
|---|---|---|
| **A. Web-first (recommended)** | Reuses Next.js, Supabase, auth and sessions; no installer; ships in ~2–3 weeks | Chrome only. Meeting must run in a Chrome tab (Meet, Zoom web, Teams web), except on Windows where "entire screen + share system audio" also covers desktop apps. Browsers have no global hotkeys or true overlay. |
| B. Electron desktop now | Matches FRAI: any meeting app, true overlay, global hotkeys | New app, packaging and signing, native audio on macOS; 2–3× the effort before the first real call |

### C.2 What's in the MVP

1. Dual audio capture in the browser: mic via `getUserMedia`, interviewer via `getDisplayMedia` with audio (tab audio, or system audio on Windows).
2. Streaming STT with interim results and end-of-utterance events. Recommended: **Deepgram live** with `nova-3`, two channels, `interim_results`, `utterance_end_ms`, and a `Finalize` message on end of speech.
3. Question gate: heuristics plus an optional fast classifier, with **Answer now** and supersede.
4. A **streaming answer route** with a context pack (resume + JD + company/role) and a provider-agnostic model (via `llmRouter`).
5. Answer window: **Document Picture-in-Picture** (Chrome 116+), always on top, falling back to the in-page panel.
6. Persistence off the hot path: transcripts and answers written to `copilot_events` asynchronously.
7. Latency instrumentation plus a scripted end-to-end test and a real-call checklist.

### C.3 Pause or cut so you can ship

Hide these behind flags or remove them from navigation; don't delete code yet. Add flags in [`src/lib/features.ts`](../src/lib/features.ts) and hide entries in [`AppShell.tsx`](../src/components/AppShell.tsx).

| Pause | Paths |
|---|---|
| Teams / enterprise / SSO | `src/app/[locale]/teams`, `src/app/api/teams/**`, `src/lib/sso.ts`, `src/lib/organizations.ts` |
| Admin dashboard | `src/app/[locale]/admin`, `src/app/api/admin/**` |
| Analytics funnel/cohort/reports (mock data) | `src/app/[locale]/analytics/**`, `src/app/api/analytics/**`, `src/components/analytics/**` |
| Video-conferencing scaffolding | `src/app/api/video-sessions/**`, `src/lib/videoConferencing*.ts`, `src/lib/useVideoConferencing.ts`, `src/app/api/settings/video-conferencing` |
| Scheduling / Google Calendar / integrations | `src/app/api/scheduling/**`, `src/lib/google-calendar.ts` |
| Social, badges, referrals, push notifications | `src/app/api/{social,badges,referrals,push,notifications}/**` and their components |
| Job hunter, cover letters | `src/app/[locale]/jobs`, `src/components/JobsClient.tsx`, `src/app/api/cover-letters/**` |
| Resume "generate / deep review" (no worker) | `src/app/api/resume/generate` and its UI button |
| Mock interviews | Keep the pages, mark "coming soon"; rebuild after MVP on the same streaming answer route |
| Chrome extension | Freeze `chrome-extension/**`; the web MVP doesn't need it |
| Extra locales | Keep the `next-intl` wiring, ship `en` only |
| Dead STT providers | Delete or replace `src/lib/sttProviders/**` in step 2 |

**Keep:** auth, onboarding (trimmed), resume upload and parse (feeds context), copilot sessions, events, summaries, reports, consent and retention, quota (simplified), and the Stripe webhook.

---

## Part D: Step-by-step build plan (priority order)

Size: **S** ≤ 1 day · **M** 2–3 days · **L** 4+ days. Every step ends with an acceptance check.

### Step 0: Make it runnable (S) — *blocks everything*

- Restore the "Finalroundy" Supabase project (or create a fresh one). **Needs your approval:** restoring may have cost implications.
- Renumber the duplicate migrations to unique, ordered versions after checking dependencies, then apply all of them: `supabase/migrations/0008_*`, `0009_*`, `0010_*`, `0015_*`.
- Create `.env.local` from [`.env.example`](../.env.example), and add `DEEPGRAM_API_KEY` and the model settings (step 4) to the example.
- Fix the build: make the admin client lazy in [`src/lib/resumeParser.ts:5`](../src/lib/resumeParser.ts) (create it inside the functions that use it).
- Fix `/` → `/en` (404 today): [`middleware.ts`](../middleware.ts), [`src/i18n/routing.ts`](../src/i18n/routing.ts). Optionally rename to Next 16's `proxy.ts` convention.
- ✅ **Done when:** `next build` passes with env set, and sign-up, login, dashboard and the live page load locally against the real project.

> **Status (2026-10-19): done, except the signed-in check, which needs you to log in.** Branch `feat/live-copilot-mvp`.
> - Supabase "Finalroundy" restored. It already had 0001–0006; applied 0007–0024 and aligned `schema_migrations` to `0001`–`0024`.
> - Migration bugs fixed on the way: `jobs` was redefined by two migrations (job postings now live in `job_postings`); a `gin` index on plain `text`; invalid `for read` policies; `0019` support tickets readable and editable by every user, plus recursive `admin_users` policies; `0020` policy referenced a table before creating it, unqualified columns let any org owner manage every org, and recursive membership policies.
> - New migrations: `0023` makes the quota RPCs service-role only (they were anon-callable with any user id). `0024` creates a `profiles` row on sign-up and backfills it; without it, onboarding could never complete and the dashboard redirected forever.
> - Security: the admin API routes (`users`, `fraud`, `tickets`, `subscriptions`, `analytics`) had **no auth** and ran with the service-role key, so anyone could grant themselves `super_admin`. All admin routes now call `requireAdmin()` ([`src/lib/adminAuth.ts`](../src/lib/adminAuth.ts)).
> - App fixes: lazy admin client in `resumeParser.ts`; blank env values treated as unset; middleware moved to [`src/proxy.ts`](../src/proxy.ts) (it was never loaded at the repo root, so `/` returned 404 and sessions weren't refreshed); `AppShell` was an async client component, so pages never hydrated; `next.config.ts` blocked the microphone (`Permissions-Policy`) and pinned dev chunks as `immutable`.
> - Verified: `next build` ✅, Jest 208/208 ✅, `tsc` ✅, ESLint 0 errors. Headless Chromium: `/` → `/en`; auth, dashboard, live, resume, jobs and settings all hydrate with no console errors; protected and admin APIs return 401 when signed out.
> - Still open: put `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` in `.env.local`; consider enabling leaked-password protection in Supabase Auth; `rls_auto_enable()` (not from this repo) is anon-callable; navbar branding still says "FinalRound".
> - Before un-pausing referrals: `referral_tracking` lets anyone insert rows (`with check (true)`), and both the referrer `UPDATE` policy and `PATCH /api/referrals` let a user mark their own referral `converted` (bumping `conversion_count` and awarding a badge). Move conversion server-side (for example, from the Stripe webhook with the service role), then drop or tighten those policies and the route. No credit is granted today, so the impact is forged counters, badges and spam rows.

### Step 1: Dual audio capture in the browser (M)

- New `src/lib/audio/capture.ts`: `getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}})` → **candidate**, and `getDisplayMedia({video:true, audio:true, systemAudio:'include'})` → **interviewer**. Keep the video track for step 8. Detect and report a missing audio track ("tick *Share tab audio*") and the `ended` event (user stopped sharing).
- New `public/worklets/pcm16-worklet.js`: an AudioWorklet that downsamples to **16 kHz mono PCM16** in ~20–50 ms frames, interleaving 2 channels (0 = candidate, 1 = interviewer).
- New hook `src/components/copilot/useAudioCapture.ts`. Remove the Web Speech path and the manual speaker dropdown from [`LiveCopilotClient.tsx`](../src/components/LiveCopilotClient.tsx).
- ✅ **Done when:** in a Meet call in a Chrome tab, level meters move independently for you and the interviewer.

> **Status (2026-10-19): built; the real-call check is still yours.**
> - Added [`capture.ts`](../src/lib/audio/capture.ts), [`pcm16-capture-worklet.js`](../public/worklets/pcm16-capture-worklet.js), [`useAudioCapture`](../src/components/copilot/useAudioCapture.ts) and [`AudioSourcesPanel`](../src/components/copilot/AudioSourcesPanel.tsx) with two level meters. The share prompt is requested before the mic, because Chrome only allows it straight from the click. Capture stops when the session ends or the user stops sharing.
> - Web Speech removed. Deviation from the plan: the speaker dropdown stays, but only for typed lines (the "10-sec filler" button needs it to send a line as the candidate).
> - Verified: 17 new unit tests (worklet DSP, meter math, capture flow with mocked browser APIs). The worklet also ran in headless Chromium's real audio engine: 16 kHz output from both 16 kHz and 48 kHz contexts, 50 ms frames, channels independent. Full suite 231/231, `tsc` and `next build` pass.
> - Not verified: the real share prompt in a live Meet call. Expect one lint warning (`enqueueTranscriptChunk` unused) until Step 2 feeds STT finals into it.

### Step 2: Streaming STT (M)

- New `src/app/api/stt/token/route.ts`: authenticated route that mints a **short-lived** Deepgram token server-side so the API key never reaches the browser (rate-limited, checks an active session and quota). 🔶 Check the current Deepgram docs for the temporary-token endpoint and the browser WebSocket auth method.
- New `src/lib/stt/deepgramLive.ts` (client): one WebSocket, `multichannel=true&channels=2&encoding=linear16&sample_rate=16000&model=nova-3&interim_results=true&smart_format=true&endpointing=300&utterance_end_ms=1000&vad_events=true`. Send `KeepAlive` while idle, send `Finalize` when a channel goes quiet, reconnect with backoff, and keep a **small ring buffer** (~5–10 s) replayed after reconnect. Roles come from the channel.
- Replace or delete [`src/lib/sttProviders/*`](../src/lib/sttProviders) and [`src/lib/sttProvider.ts`](../src/lib/sttProvider.ts).
- ✅ **Done when:** interim interviewer text appears within ~300 ms of speech, finals arrive ≤ 1 s after they stop talking, and a 60-minute call keeps transcribing through a Wi-Fi blip.

> **Status (2026-10-20): built; needs a Deepgram key and a real call to check the latency targets.**
> - Token route [`/api/stt/token`](../src/app/api/stt/token/route.ts): signed-in owner of an **active** session only (not stopped, heartbeat fresh), rate-limited per IP and per user, and refuses once the session's elapsed minutes exceed what the plan has left. It calls Deepgram `POST /v1/auth/grant` (30 s TTL) and returns `{token, expiresIn, listenUrl}`; the API key never leaves the server. Confirmed in the installed `@deepgram/sdk` 4.11.3: the grant endpoint, and browsers authenticate with the WebSocket subprotocol `["bearer", token]`.
> - Client [`deepgramLive.ts`](../src/lib/stt/deepgramLive.ts): one socket, URL from [`deepgramListenUrl.ts`](../src/lib/stt/deepgramListenUrl.ts) (`nova-3`, 2 channels, `multichannel`, `interim_results`, `endpointing=300`, `utterance_end_ms=1000`, `vad_events`). Roles come from `channel_index`. A fresh token on every reconnect, backoff 250 ms → 8 s, and a 10 s ring buffer: after a drop it replays everything Deepgram hadn't finalized, then drops words the old connection already delivered. `KeepAlive` after 4 s without audio; `Finalize` when a speaking channel is quiet for 600 ms (that channel's flushed result counts as end of speech); `CloseStream` on stop so the last words arrive. It retries forever while the network is down, and gives up only on a refused token (signed out, quota, not configured) or 5 refused sockets in a row.
> - [`utterances.ts`](../src/lib/stt/utterances.ts) joins finals into one utterance per speaker turn (closes on `speech_final` or `UtteranceEnd`). [`useLiveTranscription`](../src/components/copilot/useLiveTranscription.ts) runs it while audio is live; utterances go through the existing transcript queue, and the audio panel shows live captions and a Transcribing / Reconnecting badge.
> - Interim suggestion rule until Step 3: interviewer utterances of 3+ words still ask the old transcript route for a suggestion.
> - Removed `src/lib/sttProvider.ts` and `src/lib/sttProviders/**` (only tests used them). New env: `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE` (optional).
> - Verified: 35 new tests (route, client with a fake socket, assembler, panel, token errors); full suite 242/242, `tsc`, `next build`, ESLint 0 errors. The real client also ran in headless Chromium against a local fake Deepgram server: the server saw `Sec-WebSocket-Protocol: bearer, <token>`, 3,200-byte frames arrived in order, and a forced drop reconnected with a new token, replayed from the right frame and did not repeat a word (this caught a dedupe bug, now fixed). Finalize and CloseStream worked. Pages still hydrate with no console errors; the route returns 401 when signed out.
> - Not verified: real Deepgram (`DEEPGRAM_API_KEY` is empty in `.env.local`), the ~300 ms interim and ≤ 1 s final targets, and a 60-minute call.
> - Blockers for that test: the **free plan has 0 copilot minutes**, so starting a session needs a Pro `subscriptions` row, and Pro's per-session cap is **30 minutes**, below the 60-minute acceptance run. Raise the cap or test with a custom plan.
> - Known gaps: words spoken in the second before you press Stop session can be dropped (the transcript queue clears when the session ends); `@deepgram/sdk` is now unused and can be removed from `package.json`.
> - **Security follow-up: resolved 2026-10-20 with a server-side relay.** A security review found two problems with sending Deepgram tokens to the browser:
>   1. A token is only checked when the socket opens, so a modified client could keep streaming after its session ended or its minutes ran out.
>   2. Deepgram's temporary tokens work on `/listen`, `/speak`, `/read` and `/agent` with any parameters (confirmed in Deepgram's docs).
>
>   **The fix:** audio now goes browser → our server → Deepgram, and `/api/stt/token` is gone.
>   - **Where it runs:** you chose a custom Node server. [`server.ts`](../server.ts) runs Next.js and the relay on one port, `npm run dev` and `npm start` use it (`npm run dev:next` is plain Next with no transcription), and it is built with `tsc -p tsconfig.server.json` into `.server/`. **It can't run on Vercel**: deploy to a Node host such as Render, Fly, Railway or Docker.
>   - **Connecting:** [`sttRelay.ts`](../src/server/sttRelay.ts) checks the Origin header and the Supabase session cookie. The user must own the session, which must be active with a fresh heartbeat and consent; minutes must be left; and each user is limited to 12 connections a minute. Only then does it open Deepgram, with our key and fixed parameters.
>   - **While streaming:** the browser can send only PCM16 audio and `KeepAlive` / `Finalize` / `CloseStream`. The relay re-checks the session every 15 s and the quota every 60 s, and closes the stream when either fails. A newer connection for the same session replaces the older one, and Deepgram is closed the moment the browser goes away.
>   - **Browser:** [`relayProtocol.ts`](../src/lib/stt/relayProtocol.ts) defines the close codes, and the client shows a message and stops for final ones (signed out, session ended, quota, replaced, not configured). For everything else it reconnects with replay; it now retries indefinitely while the server is unreachable.
>   - **Dependencies:** `ws` was added to `package.json`. It was already installed (via `@deepgram/sdk`), so nothing was downloaded.
>   - **Verified:** 16 relay tests on real sockets (fake Deepgram), plus updated client tests: 292/292. The custom server runs in dev and production. Through it, the relay closed with `4503 stt_not_configured` (keys empty) and `4400` for a foreign Origin, HMR sockets still reach Next, and all pages hydrate with no console errors.
>   - **Not verified:** a real Deepgram stream through the relay (needs `DEEPGRAM_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, plus a signed-in session).
>   - **Still recommended:** a dedicated Deepgram project with a member-role key and a spending cap.

### Step 3: Question gate (M)

- New `src/lib/copilot/questionGate.ts` (pure and unit-testable). Collect interviewer finals until `UtteranceEnd`, then score: ends with `?`, wh-words, imperative prompts ("tell me about", "walk me through", "how would you", "describe", "design a", "can you"), and a minimum word count. Below a confidence band, optionally call a **fast classifier** (`{answer:boolean, category:'behavioral'|'technical'|'coding'|'system_design'|'other'}`) with a ~600 ms budget, and skip on timeout.
- Your own design, not FRAI's: also add **Answer now** (button + `Space`/`A` while the answer window is focused) and **supersede** (a new question aborts the in-flight answer via `AbortController`).
- Unit tests in `src/lib/__tests__/questionGate.test.ts` with a corpus of real interview utterances, including non-questions like "great, thanks" and "let me share my screen".
- ✅ **Done when:** on the test corpus, it answers ≥ 90% of real questions and ≤ 10% of non-questions.

> **Status (2026-10-20): built; the corpus target is met; not yet tried in a real call.**
> - [`questionGate.ts`](../src/lib/copilot/questionGate.ts) scores each interviewer utterance. Signals: a final `?`, wh- and yes/no question forms, and interview prompts ("tell me about", "walk me through", "how would you", "given an array…", "design a…", "I'd love to hear…"). Short follow-ups such as "Why?" or "How so?" also count. It says no to call logistics ("can you hear me", "you're on mute"), small talk, understanding checks ("does that make sense") and acknowledgements. Score ≥ 0.6 answers, ≤ 0.3 skips, and anything in between goes to the classifier.
> - It also gives a category (behavioral / technical / coding / system_design / other) for Step 4's prompt.
> - Turns: interviewer lines less than 4 s apart form one turn, and the question sent includes up to 3 of the turn's lines for context. If a short line without `?` fired and the next line finishes it ("Tell me about a time" / "you disagreed…"), it fires again with the whole question. A complete question followed by a remark or filler does not re-fire. The candidate speaking ends the turn.
> - Classifier: new `POST /api/copilot/sessions/[id]/gate` (owner, active session, consent, rate-limited). It uses `COPILOT_GATE_MODEL`, default `gpt-4o-mini`, with JSON output, a 1.5 s server timeout and no retries. The client gives it 600 ms. On timeout, failure or no key, lines scoring ≥ 0.45 are still answered.
> - Answer now: a button plus the **A** key (ignored while typing). It answers the current interviewer turn plus any words still being spoken, or the last turn if the candidate has started answering. **Space** waits for Step 5's answer window, where it won't fight page scrolling.
> - Supersede: [`answerController.ts`](../src/lib/copilot/answerController.ts) keeps one answer in flight, and a newer question or Answer now aborts the previous one via `AbortController`. Stop cancels.
> - To make abort real I added a small JSON route, `POST /api/copilot/sessions/[id]/answer`. It passes the request's abort signal to the OpenAI call and saves nothing once aborted. **Step 4 turns this route into the streaming one** instead of creating a new file.
> - STT lines are now saved with `autoSuggest: false`; only the gate (or Answer now) asks for answers. The live page shows a "Current question" card, and suggestion cards show the question they answer.
> - Small fix on the way: the SSE stream appended events without de-duplicating, so one arriving in both a POST response and the stream showed twice.
> - Corpus: [`questionGate.test.ts`](../src/lib/__tests__/questionGate.test.ts) has 60 interviewer questions and 40 non-questions in Deepgram style, some missing their `?`. Heuristic only: **59/60 questions answered (98%)** and **0/40 non-questions answered**; 6/60 categories differ from my labels (the test allows 15%). The miss is "What happens when the database becomes the bottleneck" without a `?`, exactly the kind of line the classifier is for. I wrote the corpus while tuning the rules, so treat these numbers as optimistic until real calls add lines.
> - Verified: 40 new tests (gate, corpus, controller, both routes, card). Full suite 282/282, `tsc`, `next build`, ESLint 0 errors. Pages hydrate with no console errors, and the new routes return 401 when signed out.
> - Not verified: classifier and answer quality against OpenAI (`OPENAI_API_KEY` is empty), and the gate on live speech.

### Step 4: Streaming answer route + context pack (M)

- New `src/app/api/copilot/sessions/[id]/answer/route.ts`: `POST {question, category, recentTranscript}` → **streams** text (`text/event-stream` from a `ReadableStream`, Node runtime). It checks auth, session ownership, heartbeat and quota, the same as the existing routes.
- Add **streaming** to [`src/lib/llmRouter.ts`](../src/lib/llmRouter.ts) (OpenAI `stream:true`, Anthropic `messages.stream`) and route model choice through env `COPILOT_ANSWER_MODEL` / `COPILOT_GATE_MODEL`. Pick a fast tier by measured time-to-first-token: `gpt-4o-mini` (today's default) or `claude-haiku-5-5` (Anthropic SDK is already a dependency), with a stronger model (e.g. `claude-sonnet-5-5`) for coding and vision.
- **Context pack** at session start. Extend [`sessions/start/route.ts`](../src/app/api/copilot/sessions/start/route.ts) to accept `resumeDocumentId`, `jobDescription`, `company`, `role`. Build a compact pack once: resume `parsed_text` trimmed to ~1.5k tokens, the key facts of the JD, and company and role. Store it in `copilot_sessions.metadata.context_pack` (no migration needed). Put it in a **stable system-prompt prefix** so provider prompt caching applies.
- Prompt, written in your own words: speak as the candidate in first person; open with one sentence you can say aloud, then 3–5 short bullets; STAR for behavioral; cite real resume facts and never invent any; for coding, approach → complexity → code; answer in the session's language.
- Strip the inline LLM calls from [`transcript/route.ts`](../src/app/api/copilot/sessions/[id]/transcript/route.ts) and [`events/route.ts`](../src/app/api/copilot/sessions/[id]/events/route.ts) so they become pure persistence (batch insert of finals).
- Persist the question and the final answer to `copilot_events` **after** the stream ends, using `after()` from `next/server` so it stays off the hot path.
- ✅ **Done when:** first token ≤ 800 ms after the route is called (p50), and answers reference the right resume facts.

### Step 5: Answer window and UI split (M)

- New `src/components/copilot/AnswerWindow.tsx`, rendered into a **Document Picture-in-Picture** window (`documentPictureInPicture.requestWindow`), always on top. It shows the transcript tail, a question card, the streaming answer, Answer now / Stop / font size controls, and a "connection: live / reconnecting" pill. Falls back to the in-page panel.
- Split [`LiveCopilotClient.tsx`](../src/components/LiveCopilotClient.tsx) (2,195 lines) into `useAudioCapture`, `useLiveTranscription`, `useQuestionGate` and `useAnswerStream` plus small presentational components. Keep history, export and purge as they are.
- Pre-session setup step: pick a resume, paste the JD, and enter company and role. Reuse the resume list from [`ResumeClient.tsx`](../src/components/ResumeClient.tsx) data.
- ✅ **Done when:** you can keep the meeting tab in front and read streamed answers in the floating window.

### Step 6: Latency and reliability instrumentation (S)

- Record `speech_end → final`, `final → gate`, `gate → first_token` and `first_token → done` per turn using [`copilotLatency.ts`](../src/lib/copilotLatency.ts) / [`sloClient.ts`](../src/lib/sloClient.ts). Show them in a debug drawer.
- Auto-end sessions on tab close or stopped sharing, plus heartbeat (existing).
- ✅ **Done when:** a dashboard or log shows p50/p95 per stage for each session.

### Step 7: Tests that prove the loop (M)

- Unit tests: gate, PCM worklet math, SSE stream parser, context-pack builder.
- Playwright e2e `e2e/copilot-live.spec.ts`: launch Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=e2e/fixtures/interviewer-question.wav`. Behind a dev-only flag, route the fake mic into the interviewer channel and assert that a streamed answer appears. Run it against a test Supabase project with real STT and LLM keys in a CI secret, or behind a manual workflow.
- Replace the current shallow [`e2e/copilot.spec.ts`](../e2e/copilot.spec.ts) checks.
- ✅ **Done when:** CI goes from fake audio question → transcript → answer tokens green.

### Step 8: Real-call validation (S) — *the MVP gate*

Checklist, each run with a friend playing interviewer for 15+ minutes:

- [ ] Google Meet in a Chrome tab, sharing that tab with audio
- [ ] Zoom web client in Chrome
- [ ] Teams web in Chrome
- [ ] Windows only: Zoom/Teams **desktop** app via "Entire screen + Share system audio"
- [ ] Headphones on (the normal interview setup)
- [ ] Wi-Fi blip mid-question (toggle airplane mode for 3 s)
- [ ] 60-minute session
- [ ] p50 speech-end → first answer token ≤ 1.5 s; p95 ≤ 3 s

Known limitation to verify: on macOS, Chrome reliably captures **tab** audio only, so the Zoom/Teams desktop apps on Mac wait for the desktop phase.

### Step 9 (MVP+): Coding copilot (M)

- On Answer now with "screen", or a dedicated button: grab a frame from the **display video track you already have** (`ImageCapture.grabFrame()` or a canvas) → JPEG → SHA-256 for dedup → `POST /api/copilot/sessions/[id]/screen` (new) → vision-capable model → streamed result into the same answer window, with a code block and complexity.
- Optionally store screenshots in Supabase Storage with retention through the existing [`copilotRetention.ts`](../src/lib/copilotRetention.ts).

### Step 10 (only if you charge at launch): Billing (S)

- New `src/app/api/billing/checkout/route.ts` (Stripe Checkout Session for `PRICE_ID_PRO_*`) and `src/app/api/billing/portal/route.ts`, wired to [`webhooks/stripe`](../src/app/api/webhooks/stripe/route.ts) and [`quota.ts`](../src/lib/quota.ts). Upgrade the pinned Stripe API version in [`src/lib/stripe.ts`](../src/lib/stripe.ts) deliberately.

### After the MVP (not in scope now)

1. **Desktop app (Electron)** that wraps the same web UI. Windows system audio via `session.setDisplayMediaRequestHandler(... audio: 'loopback')` (no native addon); macOS via ScreenCaptureKit or Core Audio Taps (🔶 native work or a maintained addon; verify Electron's current macOS loopback support). Always-on-top overlay windows, global hotkeys, auto-update. **Harden Electron fuses** (`RunAsNode` off, ASAR integrity on, `OnlyLoadAppFromAsar` on), which FRAI doesn't.
2. Mock interviews with an AI interviewer on the same streaming route; voice and avatar later.
3. Phone / in-person mode: single mic + diarization primed with a voice sample.
4. RAG over documents with provenance, long-term "memory" per goal, playbooks.
5. Revisit the paused modules.

---

## Part E: Decisions I need from you

| # | Decision | My recommendation |
|---|---|---|
| 1 | Web-first MVP (Option A) or desktop now (Option B)? | **A.** Fastest path to a real call; desktop next. |
| 2 | Restore Supabase "Finalroundy" or start a fresh project? | Restore, if the data is worth keeping; otherwise a fresh project with renumbered migrations. |
| 3 | STT vendor | **Deepgram live** (SDK already in deps; multichannel + utterance-end + `Finalize`). Alternative: OpenAI Realtime transcription. |
| 4 | Answer model | Fast tier chosen by measured TTFT: `gpt-4o-mini` or `claude-haiku-5-5`; stronger model for coding/vision. Configurable per env. |
| 5 | Stealth / "hidden from screen share" | Your product and ethics call. A PiP window is visible if you share your **entire screen**, but not if you share only the meeting tab. FRAI itself says hiding isn't guaranteed, and many employers forbid hidden assistance. The MVP works either way. |
| 6 | Charge at launch? | If not, skip step 10. |

## Part F: Risks

- **Browser capture friction:** the user must pick the right tab and tick "Share tab audio". Mitigation: a guided preflight with a live level meter for each channel.
- **Echo:** your mic picks up speaker audio when you're not on headphones, which can duplicate the interviewer's words. Mitigation: echo cancellation, recommend headphones, de-duplicate near-identical overlapping finals.
- **Cost:** streaming STT for 60 minutes × 2 channels, plus LLM calls. Mitigation: gate before answering, send silence-free audio (add a client VAD later if needed), use quotas.
- **Vendor latency variance:** measure TTFT per model in step 6 and keep the model configurable.
- **Platform policy:** some interview platforms and employers prohibit assistants. Make this visible in onboarding and the terms.
