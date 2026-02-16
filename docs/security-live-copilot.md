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
- **User deletion**: delete session-scoped records (`events`, `summaries`) when a user deletes a session/account, except legally required billing records.
- **Operational logs**: avoid raw transcript content in infrastructure logs; retain only minimal operational metadata.

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

## 7) Recommended Next Hardening

- Add explicit security event metric counters (redaction count, injection-detected count).
- Add retention jobs (scheduled purge) for events/summaries.
- Add unit tests for sanitizer edge-cases and prompt-injection pattern tuning.
- Add DSAR/admin delete endpoint coverage tests.
