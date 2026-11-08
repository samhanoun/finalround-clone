# Deploying Apex Round

Apex Round runs as **one long-lived Node process** (`server.ts`): Next.js plus a
WebSocket relay for live speech-to-text at `/api/stt/stream`. It cannot run on
Vercel or any serverless host. Use a Node/Docker host that supports WebSockets
(Render, Fly.io, Railway, a VPS).

`npm run build` runs `next build` and compiles `server.ts` into `.server/`.
`npm start` runs `node .server/server.js --production` on `$PORT` (default 3000).
The `Dockerfile` does the same in a slim non-root image.

## 1. What you need

Accounts and keys: Supabase, Deepgram, OpenAI and/or Anthropic, Stripe, SendGrid,
web push (VAPID) keys, and a host. Generate secrets locally:

```bash
openssl rand -hex 32                 # CRON_SECRET, SSO_VERIFY_SECRET
npx web-push generate-vapid-keys     # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

### Environment variables

"Build" means `NEXT_PUBLIC_*`: the value is inlined into the browser bundle, so it
must be present when the image is built (Docker build args) and, for server code, at runtime.

| Variable | Purpose | Required | When |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Required | Build + runtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable (anon) key | Required | Build + runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase access (STT relay, scheduler, billing sync) | Required | Runtime |
| `NEXT_PUBLIC_APP_URL` | Public https URL of the app; Stripe redirects and allowed WebSocket origin | Required in production | Build + runtime |
| `NEXT_PUBLIC_BETA_LIVE_COPILOT` | Live copilot is on by default; set `false` or `0` to hide it | Optional | Build |
| `PORT` | Listen port (default 3000) | Optional | Runtime |
| `HOSTNAME` | Bind address (`0.0.0.0` in the image) | Optional | Runtime |
| `LLM_PROVIDER` | `openai`, `anthropic`, `google` or `auto` | Optional | Runtime |
| `OPENAI_API_KEY` | OpenAI models | Required unless Anthropic is used | Runtime |
| `ANTHROPIC_API_KEY` | Anthropic models (and `claude-*` copilot models) | Optional | Runtime |
| `COPILOT_GATE_MODEL`, `COPILOT_ANSWER_MODEL`, `COPILOT_CODING_MODEL` | Live copilot models | Optional | Runtime |
| `DEEPGRAM_API_KEY` | Speech-to-text; without it live transcription is off | Required for live sessions | Runtime |
| `DEEPGRAM_MODEL`, `DEEPGRAM_LANGUAGE`, `DEEPGRAM_LISTEN_URL` | Deepgram model, language, endpoint override | Optional | Runtime |
| `STRIPE_SECRET_KEY` | Stripe API (checkout, portal, sync) | Required for billing | Runtime |
| `STRIPE_WEBHOOK_SECRET` | Verifies `/api/webhooks/stripe` | Required for billing | Runtime |
| `PRICE_ID_PRO_EUR`, `PRICE_ID_PRO_USD` | Monthly Pro price ids | Required for billing | Runtime |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared rate limiting | Optional | Runtime |
| `CRON_SECRET` | 32+ chars; authenticates external cron calls | Required for the retention sweep | Runtime |
| `NOTIFICATION_SCHEDULER` | `off` disables the built-in 5-minute scheduler | Optional | Runtime |
| `SENDGRID_API_KEY` | Email (SendGrid; `src/lib/email.ts`) | Required for email | Runtime |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | Sender (address must be verified in SendGrid) | Recommended | Runtime |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push | Required for push | Runtime |
| `SUPABASE_MANAGEMENT_TOKEN` | Registers team SAML identity providers (Supabase personal access token) | Required for team SSO | Runtime |
| `SUPABASE_PROJECT_REF` | Project ref; derived from the URL when unset | Optional | Runtime |
| `SSO_VERIFY_SECRET` | Derives the DNS TXT value for team domain verification (falls back to the service role key) | Required for team SSO | Runtime |

`.env.example` has the same list with comments. Never commit real values.

## 2. Supabase

1. Create a project. Copy the URL, publishable (anon) key and service role key.
2. Apply migrations `0001` to `0031` from `supabase/migrations`:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
3. Authentication -> URL configuration:
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/api/auth/callback` (or `https://<your-domain>/**`). Add `http://localhost:3000/api/auth/callback` for local work.
4. For team SSO, enable SAML (Pro plan or above) and set `SUPABASE_MANAGEMENT_TOKEN` and `SSO_VERIFY_SECRET`.

### Google sign-in

1. Google Cloud Console -> APIs & Services -> Credentials -> Create OAuth client ID (Web application).
2. Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase -> Authentication -> Providers -> Google: enable, paste the client ID and secret, save.
4. The app's own `/api/auth/callback` must be in the Redirect URLs list from step 2.3.

## 3. Stripe

1. Create a "Pro" product with two monthly recurring prices (EUR and USD); put their ids in `PRICE_ID_PRO_EUR` / `PRICE_ID_PRO_USD`.
2. Settings -> Billing -> Customer portal: enable and save once.
3. Developers -> Webhooks -> add endpoint `https://<your-domain>/api/webhooks/stripe`, API version `2026-09-30.endive`, events:
   - `checkout.session.completed`
   - `customer.created`, `customer.updated`
   - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Put the signing secret in `STRIPE_WEBHOOK_SECRET`. Start in test mode (`sk_test_...`). Details: `STRIPE_SETUP.md`.

## 4. Cron jobs

- `/api/cron/notifications` (reminders and weekly digest): the server calls it itself every 5 minutes, so **no external job is needed** unless you set `NOTIFICATION_SCHEDULER=off`. External call: `POST` with `Authorization: Bearer $CRON_SECRET`.
- `/api/cron/retention` (deletes old copilot data, see `docs/RETENTION_SCHEDULER.md`): schedule daily, for example 03:00 UTC. `POST https://<your-domain>/api/cron/retention?dryRun=false` with the header `Authorization: Bearer $CRON_SECRET` (never put the secret in the URL: URLs end up in logs). Without `dryRun=false` it only reports. Needs `CRON_SECRET`.

There is no `vercel.json`. Use your host's cron (Render Cron Job, Railway cron service, Fly scheduled machine) or any external scheduler, for example:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/cron/retention?dryRun=false"
```

## 5. Hosting (Docker)

**WebSockets are required.** The live copilot streams audio over `wss://<domain>/api/stt/stream`; hosts or proxies that block upgrades break live transcription. Run a single instance, or enable sticky sessions if you scale out.

Build args (all hosts): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, and optionally `NEXT_PUBLIC_BETA_LIVE_COPILOT`. Everything else is runtime env. Health check: `GET /api/health`. Container port: 3000.

Local test:

```bash
docker build -t apex-round \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  --build-arg NEXT_PUBLIC_APP_URL=http://localhost:3000 .
docker run --rm -p 3000:3000 --env-file .env.local apex-round
```

### Render

1. New -> Web Service -> connect the repo, Language: Docker.
2. Environment: add the runtime variables and the `NEXT_PUBLIC_*` ones (Render exposes service env vars to the Docker build as build args that the Dockerfile declares with `ARG`).
3. Health check path `/api/health`. Use a paid instance type (free ones sleep).
4. Add a Cron Job for the retention call above.

### Fly.io

```bash
fly launch --no-deploy            # detects the Dockerfile; set internal_port = 3000
fly secrets set SUPABASE_SERVICE_ROLE_KEY=... DEEPGRAM_API_KEY=... OPENAI_API_KEY=...   # and the rest
fly deploy \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
  --build-arg NEXT_PUBLIC_APP_URL=https://<app>.fly.dev
```

In `fly.toml` keep `internal_port = 3000`, `force_https = true`, `auto_stop_machines = "off"` and `min_machines_running = 1` (the scheduler and live sockets need the process awake). Fly proxies WebSockets without extra config.

### Railway

1. New Project -> Deploy from GitHub repo; Railway detects the `Dockerfile`.
2. Variables: add the runtime variables. Variables matching a Dockerfile `ARG` (the `NEXT_PUBLIC_*` ones) are used at build time.
3. Settings -> Networking -> Generate Domain (or add a custom domain), target port 3000. Healthcheck path `/api/health`.
4. WebSockets work by default. Add a cron service running `curl` for the retention call.

After the first deploy you know the https URL: set `NEXT_PUBLIC_APP_URL`, rebuild (it is a build arg), then update Supabase redirect URLs and the Stripe webhook URL.

## 6. Desktop app

The desktop app loads the deployed site and needs the **https** URL. Either set `appUrl` in `desktop/app.config.json` (`{"appUrl": "https://<your-domain>"}`) or set the `APEX_APP_URL` repository variable (Settings -> Secrets and variables -> Actions -> Variables) used by the desktop release workflow. See `desktop/README.md`.

## 7. Post-deploy checklist

- [ ] `https://<domain>/api/health` returns `{"status":"ok"}`.
- [ ] Sign up with email, confirm the email arrives (SendGrid), sign in.
- [ ] Sign in with Google; you land back in the app via `/api/auth/callback`.
- [ ] Upload a résumé.
- [ ] Start a live session: mic and tab audio permission, transcript appears (proves `wss://.../api/stt/stream` and Deepgram), copilot answers (LLM key).
- [ ] Stripe test checkout (card `4242 4242 4242 4242`) switches the plan to Pro; Manage billing opens the portal; the webhook shows 2xx in the Stripe dashboard.
- [ ] Enable push in Settings and trigger a notification (a reminder, or the weekly digest).
- [ ] Send an email (team invitation or analytics report).
- [ ] Retention cron: call it with `dryRun=true` and check the JSON, then schedule `dryRun=false`.
- [ ] Optional: `npm run check:live` reports no missing setup.
