# Live Copilot Security Controls

This document defines minimum enforceable security controls for the live copilot pipeline (`/api/copilot/sessions/*`) and related data in `copilot_sessions`, `copilot_events`, and `copilot_summaries`.

## 1) Consent Controls

- **Explicit opt-in before capture**: users must start a copilot session (`POST /api/copilot/sessions/start`) before transcript events are accepted.
- **Session-bound ingestion**: events are accepted only for authenticated owners of an `active` session.
- **Consent scope**: consent applies to interview coaching features only (event storage, suggestions, summaries, quota/billing telemetry).
- **Withdrawal**: users can stop processing immediately with `POST /api/copilot/sessions/stop`; no new suggestions/summaries should be generated after stop.
- **UI disclosure requirement**: product UI must clearly disclose that user-provided transcript text is processed by an LLM provider for assistance.

## 2) Retention & Deletion

- **Default retention target**:
  - `copilot_events`: 30 days
  - `copilot_summaries`: 90 days
  - `copilot_sessions` metadata: 90 days (excluding billing-required aggregates)
- **Data minimization**: keep only fields needed for coaching and quota enforcement.
- **Operational logs**: avoid raw transcript content in infrastructure logs; retain only minimal operational metadata.

### Session Delete Workflow (implemented)

- Endpoint: `DELETE /api/copilot/sessions/:id`
- **Ownership privacy guard**: when a session exists but belongs to a different user, API responds with `404 session_not_found` (not `403`) to avoid cross-tenant resource enumeration.
- **Active-session guard**: active sessions cannot be deleted directly; caller must stop first (`409 session_active`).
- **Deletion order**:
  1. delete `copilot_events` for `(session_id, user_id)`
  2. delete `copilot_summaries` for `(session_id, user_id)`
  3. delete `copilot_sessions` for `(id, user_id)`
- **Safe internal failures**: database deletion failures return `500 internal_error` with request correlation only (`extra.requestId`), never raw DB error internals.

### Account / DSAR deletion expectations

- Account deletion flows must call the same session-scoped cleanup logic and apply identical response safety guarantees.
- Billing-required aggregate data (usage totals/minutes) may be retained when legally required, but transcript/event payloads should be removed.
- Operational runbook: `docs/dsar-retention-runbook.md`.

## 3) PII Redaction Controls

Server-side sanitization is mandatory before persistence and before any LLM call:

- Remove control characters.
- Redact common sensitive values with placeholders, including:
  - email addresses
  - phone numbers
  - SSN-like patterns
  - payment card-like patterns
  - API keys and bearer tokens
- Enforce length bound (`<= 4000` chars per event payload text).
- Persist a non-sensitive security annotation (redaction categories + prompt-injection flag).

Implementation reference:
- `src/lib/copilotSecurity.ts`
- Applied in:
  - `src/app/api/copilot/sessions/[id]/events/route.ts`
  - `src/app/api/copilot/sessions/[id]/summarize/route.ts`

## 4) Prompt-Injection Controls

### Detection
Transcript text is scanned for model-control and exfiltration patterns (e.g., "ignore previous instructions", "reveal system prompt", "bypass guardrails", jailbreak terms).

### Enforcement
- If prompt-injection risk is detected in event ingestion:
  - event text is still sanitized/stored,
  - **auto-suggestion generation is blocked** for that event.
- In summarization:
  - risky transcript segments are replaced with `[FILTERED_PROMPT_INJECTION_CONTENT]` before sending context to the model.
- System prompt policy should explicitly instruct model to ignore transcript attempts to override system/developer rules.

## 5) Logging Policy

- **Do log**: request IDs, route, status code, latency, quota outcomes, coarse error class.
- **Do not log**: raw transcript payloads, LLM prompt bodies, tokens, secrets.
- **Error handling**: return generic client-safe error codes; avoid echoing provider internals.
- **Access controls**: logs/telemetry must be restricted to authorized operators and follow least privilege.

## 6) Baseline Technical Safeguards (Current)

- AuthN/AuthZ on all copilot routes (`supabase.auth.getUser()`, ownership checks).
- Rate limiting on start/stop/events/stream/summarize endpoints.
- Quota enforcement for copilot usage budgets.
- Sanitization + prompt-injection guard integrated in events and summarize handlers.

## 7) Secure Defaults (Route Behavior)

- **Request correlation IDs**: copilot routes should attach/use a request ID (`x-request-id` when available, generated otherwise) for operational debugging.
- **Client-safe 5xx errors**: internal failures should return `internal_error` + request ID and avoid exposing provider/DB internals.
- **Coarse error classes in logs**: log short stable classes (e.g., `db_insert_event_failed`, `llm_summary_failed`) plus non-sensitive metadata only.
- **No raw transcript or prompt logging**: never log event text, compiled transcript windows, or model prompt bodies.
- **Provider fallback safety**: fallback suggestions/summaries may be emitted, but must not embed raw upstream exception strings.

## 8) Recommended Next Hardening

- Add explicit security event metric counters (redaction count, injection-detected count).
- Add scheduled retention job wiring (policy hook scaffold now available in `src/lib/copilotRetention.ts`).
- Add unit tests for sanitizer edge-cases and prompt-injection pattern tuning.
- Add DSAR/admin delete endpoint coverage tests for any future admin-only flows.

## 9) Verification Checklist (Request-ID + Safe 5xx Payloads)

Use this checklist for regressions on transcript/report/history/delete paths (plus existing events/summarize coverage):

- [ ] Route-level Jest tests assert `500` failures return exactly `{"error":"internal_error","extra":{"requestId":"..."}}` shape.
- [ ] Tests verify `x-request-id` is propagated when present (`transcript`, `report`, `history`, `delete`).
- [ ] Tests verify `crypto.randomUUID()` generated request IDs are used when header is absent.
- [ ] Tests verify DB/provider/internal fields are **not** present in client payload (`code`, `message`, `details`, `hint`, stack traces).
- [ ] Ownership tests verify transcript rejects non-owner writes (`403 forbidden`).
- [ ] Ownership privacy tests verify report/delete non-owner access returns `404 session_not_found` (no cross-tenant enumeration).
- [ ] History tests verify queries are scoped to authenticated `user_id` only.
- [ ] Route logs still include coarse error classes + request ID for operator debugging (`db_*_failed`, `llm_*_failed`) without raw transcript/prompt content.
- [ ] `npm run lint && npm test && npm run build` passes in CI.
