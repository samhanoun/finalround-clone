# DSAR + Copilot Retention Runbook

## Scope
Covers privacy operations for live copilot data:
- `GET /api/copilot/sessions/export` (DSAR export)
- `DELETE /api/copilot/sessions/purge` (user-initiated purge-all)
- Retention policy hook scaffold (`src/lib/copilotRetention.ts`)

## Production safety controls
- Auth required (`supabase.auth.getUser()`)
- User ownership scoped by `user_id` on every data query
- Request correlation via `x-request-id` (generated when absent)
- Per-IP and per-user rate limits on export + purge endpoints
- Internal failures return safe envelope: `{"error":"internal_error","extra":{"requestId":"..."}}`

## DSAR export procedure
1. User signs in and calls `GET /api/copilot/sessions/export`.
2. API returns JSON attachment with:
   - request/export metadata
   - counts (`sessions`, `events`, `summaries`)
   - full user-scoped records for copilot tables
3. Verify HTTP 200 + `content-disposition: attachment`.

## Purge-all procedure
1. User signs in and calls `DELETE /api/copilot/sessions/purge` with:
   - `confirmation: "DELETE ALL COPILOT DATA"`
   - optional `confirmUserId` (must match authenticated user if provided)
2. API blocks purge when active sessions exist (`409 session_active`).
3. API deletes in dependency-safe order:
   - `copilot_events`
   - `copilot_summaries`
   - `copilot_sessions`
4. API returns deletion counts + `requestId`.

## Retention policy hooks (scaffold)
Implemented in `src/lib/copilotRetention.ts`:
- `resolveCopilotRetentionPolicy` — policy override hook
- `buildCopilotRetentionCutoffs` — deterministic policy date cutoffs
- `runCopilotRetentionSweep` — dry-run by default, explicit `dryRun: false` required for deletes

Default policy values (aligned to security policy):
- events: 30 days
- summaries: 90 days
- sessions: 90 days (`stopped|expired` only)

## Suggested scheduler integration
Use an external scheduler/worker to call retention hook with admin client:
- run daily in `dryRun: true` first
- log counts and cutoffs
- promote to `dryRun: false` after validation

## Verification
- `npm run lint`
- `npm test`
- `npm run build`
- security tests:
  - `src/app/api/copilot/sessions/export/route.security.test.ts`
  - `src/app/api/copilot/sessions/purge/route.security.test.ts`
