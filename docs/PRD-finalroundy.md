# PRD: FinalRoundy — AI Interview & Job Search Copilot Platform

- **Document Owner:** Product + Engineering
- **Version:** 1.0
- **Date:** 2026-02-16
- **Status:** Execution-ready draft
- **Target Launch:** 2 phased releases over ~24 weeks

---

## 1) Product Vision

Build an end-to-end career acceleration platform inspired by FinalRound, combining real-time interview assistance, coding interview copilot, mock interviews, resume optimization, job hunting automation, and analytics.

### 1.1 North Star
Help candidates increase interview conversion and offer rates through trustworthy AI coaching and real-time guidance while staying compliant with platform and legal boundaries.

### 1.2 Success Outcomes (12 months)
- +30% improvement in interview pass-through rate for active users.
- +25% increase in job application-to-interview conversion.
- 40% Week-4 retention for paid users.
- <300 ms p95 realtime guidance pipeline latency (excluding LLM response time).
- 99.9% availability for interview-time critical paths.

---

## 2) Personas & Jobs-to-be-Done

1. **Early-career candidate (0–3 years)**
   - Needs confidence, interview structure, and resume polish.
2. **Mid/senior engineer**
   - Needs coding/system design interview prep and high-signal coaching.
3. **Career switcher / international candidate**
   - Needs role-fit targeting, ATS-safe resume, and interview language coaching.
4. **Power applicant**
   - Needs bulk job tracking, auto-tailored applications, and funnel analytics.

---

## 3) Scope (Feature Matrix)

| Module | MVP (Phase 1) | Phase 2 | Phase 3+ |
|---|---|---|---|
| **Live Copilot** | Desktop overlay/web widget, audio transcription, context-aware answer suggestions, STAR templates, confidence prompts | Multi-language hints, interview-mode presets, interviewer intent classification | Adaptive strategy memory across companies, role-specific custom playbooks |
| **Coding Copilot** | Problem parsing, hint ladder, pseudocode guidance, complexity checks, test-case generation | Live code review + bug detection, editor plugin integration | Whiteboard OCR + multimodal coding support |
| **Mock Interviews** | Role-based mock sessions (behavioral + technical), scoring rubric, actionable feedback | Company-specific question banks, peer/mock panel mode | AI interviewer personality tuning + longitudinal progression plans |
| **Resume Builder/Optimizer** | ATS parser, JD-to-resume gap analysis, bullet rewrites, scorecard | Portfolio/LinkedIn optimization, cover letter drafting | Auto-variant resume generation by role clusters |
| **Job Hunter** | Job import (manual + board APIs), fit scoring, tracker Kanban, application reminders | Outreach assistant, interview scheduling sync, referral workflow | Autonomous apply assistant (policy controlled) |
| **Analytics** | Funnel dashboard, module usage, interview trends, weak-area heatmap | Cohort retention and ROI metrics, benchmark vs peers | Predictive offer likelihood + what-to-improve simulator |

---

## 4) Product Requirements by Module

## 4.1 Live Copilot
**User stories**
- As a candidate, I can run a low-latency copilot during interviews to receive concise prompts and structured responses.
- As a user, I can configure strictness (minimal hints vs detailed guidance).

**Functional requirements**
- Capture mic/system audio with explicit consent.
- Real-time STT (partial + final transcripts).
- Conversational context window (last N turns + role profile + resume facts).
- Response cards: short answer, STAR response, clarifying question, follow-up probes.
- Hotkey controls: mute, hide/show, “I need 10-second filler”.

**NFRs**
- p95 transcription chunk processing <150 ms (post-ingest).
- End-to-end hint delivery target <2.5 s median.

## 4.2 Coding Copilot
- Parse coding prompt text/audio.
- Generate hints in tiers: concept nudge → approach → pseudocode → edge cases.
- Runtime/space complexity evaluation.
- Unit test scaffolding and adversarial edge-case suggestions.
- Plagiarism/safety guard: configurable “no full final code” mode.

## 4.3 Mock Interviews
- Interview templates by role (SWE, PM, Data, QA).
- Timer-driven rounds and question progression.
- Auto scoring dimensions: clarity, depth, structure, correctness, communication.
- Session replay + transcript + improvement plan.

## 4.4 Resume
- Upload resume (PDF/DOCX), parse sections reliably.
- JD ingestion and match score.
- Bullet rewriting using impact formula (Action + Scope + Outcome + Metrics).
- ATS linting (keyword coverage, formatting risks).

## 4.5 Job Hunter
- Import jobs from URL or supported APIs.
- Fit score combining skills, seniority, location, compensation.
- Kanban pipeline: Saved → Applied → OA → Interview → Offer/Reject.
- Follow-up reminders and notes.

## 4.6 Analytics
- User dashboard: progress over time, weak skills, prep hours, conversion metrics.
- Admin dashboard: MAU, retention, funnel drop-offs, model cost per active user.

---

## 5) UX & Frontend Architecture

### 5.1 Client Apps
1. **Web App (Next.js/React/TypeScript)**
   - Auth, onboarding, dashboard, mock interview, resume, job tracker.
2. **Desktop Companion (Tauri or Electron)**
   - Interview overlay, hotkeys, local audio routing, privacy controls.
3. **Optional Browser Extension (Phase 2)**
   - In-tab copilot support for browser-based interview platforms.

### 5.2 Frontend Technical Design
- State: React Query + Zustand/Redux for realtime session state.
- UI: Component system (Tailwind + headless UI primitives).
- Realtime transport: WebSocket/SSE fallback.
- Observability: client traces + session replay (PII-masked).
- i18n-ready message catalogs.

### 5.3 Core UX Flows
- Onboarding: profile → resume upload → target role/company → baseline assessment.
- Interview mode: permission checks → warmup → realtime copilot with compact cards.
- Post-session: score + transcript highlights + action plan.

---

## 6) Backend Architecture

### 6.1 Services (Modular Monolith first, service split later)
- **API Gateway / BFF**: auth, rate limits, client contracts.
- **User Service**: profile, preferences, subscriptions.
- **Session Service**: interview/mock sessions, transcripts, artifacts.
- **Copilot Orchestrator**: context assembly, prompt routing, model selection.
- **Resume Service**: parsing, scoring, rewrite pipeline.
- **Job Hunter Service**: job ingestion, fit scoring, tracking.
- **Analytics Service**: event ingestion, aggregates, reporting.
- **Billing Service**: plan limits, usage metering.

### 6.2 Infrastructure
- Cloud: AWS/GCP/Azure (containerized workloads via Kubernetes).
- Queue/stream: Kafka or managed Pub/Sub.
- Cache: Redis.
- Blob/object storage: S3/GCS for transcripts/resumes/audio snippets.
- Search: OpenSearch/Elastic for job and transcript indexing.

### 6.3 AI Stack
- STT provider(s): streaming API with fallback vendor.
- LLM routing: policy-based model selection by task + cost budget.
- Vector store: pgvector or dedicated vector DB for retrieval.
- Prompt safety/guardrails: moderation + policy checks.

---

## 7) Data Model & DB Schema Additions

Assume existing `users`, `organizations`, `subscriptions`.

### 7.1 New Tables (PostgreSQL)

1. **candidate_profiles**
- id (pk), user_id (fk), target_roles[], years_exp, industries[], preferred_locations[], salary_min/max, created_at, updated_at.

2. **resumes**
- id, user_id, file_url, parsed_json (jsonb), ats_score, baseline_score, version, created_at.

3. **resume_job_matches**
- id, resume_id, job_id, match_score, missing_keywords[], suggestions_json, created_at.

4. **jobs**
- id, external_source, external_id, company, title, location, remote_type, salary_range, jd_text, metadata_json, posted_at, created_at.

5. **job_applications**
- id, user_id, job_id, stage, status, applied_at, next_followup_at, notes, created_at, updated_at.

6. **interview_sessions**
- id, user_id, type(enum: live,mock,coding), role_track, started_at, ended_at, status, settings_json, created_at.

7. **session_transcripts**
- id, session_id, speaker(enum), content, start_ms, end_ms, confidence, created_at.

8. **copilot_suggestions**
- id, session_id, timestamp_ms, category, suggestion_text, source_context_json, accepted(bool), created_at.

9. **coding_attempts**
- id, session_id, prompt_text, language, solution_text, complexity_time, complexity_space, score_json, created_at.

10. **mock_scores**
- id, session_id, rubric_json, overall_score, strengths[], weaknesses[], improvement_plan_json, created_at.

11. **events_raw**
- id, user_id, event_name, event_ts, payload_json, source, created_at.

12. **daily_metrics**
- id, date, user_id, prep_minutes, sessions_count, applications_count, interviews_count, conversion_json, created_at.

### 7.2 Indexes
- jobs(company, title, posted_at desc)
- job_applications(user_id, stage, updated_at desc)
- interview_sessions(user_id, started_at desc)
- session_transcripts(session_id, start_ms)
- events_raw(event_name, event_ts)

### 7.3 Data Retention
- Raw audio chunks: 30 days default (configurable).
- Transcript + scores: 12 months default.
- User-controlled deletion (GDPR/CCPA workflows).

---

## 8) API Contracts (v1)

### 8.1 Auth & User
- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `GET /v1/me`
- `PATCH /v1/me/preferences`

### 8.2 Resume
- `POST /v1/resumes/upload`
- `POST /v1/resumes/{id}/parse`
- `POST /v1/resumes/{id}/analyze-jd`
- `POST /v1/resumes/{id}/rewrite-bullets`

### 8.3 Jobs & Applications
- `POST /v1/jobs/import`
- `GET /v1/jobs/search`
- `POST /v1/applications`
- `PATCH /v1/applications/{id}`
- `GET /v1/applications/board`

### 8.4 Interview/Copilot
- `POST /v1/sessions`
- `POST /v1/sessions/{id}/events` (transcript chunks, user actions)
- `GET /v1/sessions/{id}`
- `POST /v1/sessions/{id}/end`
- `WS /v1/realtime/sessions/{id}` (hints, controls, partial transcripts)

### 8.5 Mock + Coding
- `POST /v1/mock/start`
- `POST /v1/mock/{id}/answer`
- `GET /v1/mock/{id}/report`
- `POST /v1/coding/evaluate`

### 8.6 Analytics
- `GET /v1/analytics/dashboard`
- `GET /v1/analytics/funnel`
- `GET /v1/analytics/progress`

### 8.7 Admin
- `GET /v1/admin/usage`
- `GET /v1/admin/model-costs`
- `POST /v1/admin/feature-flags`

---

## 9) Realtime Pipeline Design

### 9.1 Flow
1. Client captures audio/text events.
2. Ingestion gateway normalizes chunks.
3. Streaming STT transcribes partial/final text.
4. Context builder assembles latest transcript + profile + resume facts + role pack.
5. Copilot orchestrator requests LLM output (strategy + grounded response).
6. Safety/policy filter validates output.
7. Realtime channel pushes suggestion cards to client.
8. Event logger writes interactions for analytics + model tuning.

### 9.2 Latency Budget (Target)
- Audio ingest + queue: 100 ms
- STT partial: 500–900 ms
- Context build: 80 ms
- LLM first token: 700–1200 ms
- Delivery render: 100 ms
- **Total median:** ~1.6–2.4 s

### 9.3 Reliability
- Circuit breakers around STT/LLM providers.
- Fallback model path when primary degraded.
- Local cached filler prompts when network unstable.

---

## 10) Compliance, Security, and Trust

### 10.1 Security Controls
- OAuth2/JWT short-lived tokens + refresh rotation.
- At-rest encryption (KMS), in-transit TLS 1.2+.
- Row-level access control for multi-tenant data.
- Secrets vault + periodic key rotation.
- WAF + bot protection + abuse throttling.

### 10.2 Privacy & Compliance
- GDPR/CCPA data subject rights APIs.
- Explicit consent for recording/transcription.
- Configurable “no storage” interview mode.
- SOC2-ready controls (audit logs, change management, least privilege).
- Data processing agreements with AI vendors.

### 10.3 Responsible AI
- User-visible disclaimer + appropriate-use policy.
- Hallucination mitigation via confidence labels and citeable context.
- Offensive/sensitive content filters.
- Human override feedback loop.

---

## 11) Rollout Plan (Phased)

## Phase 0 (Weeks 1–3): Foundations
- Architecture skeleton, auth, telemetry, design system, CI/CD.
- DB migrations + baseline entities.
- Internal admin + feature flag framework.

## Phase 1 (Weeks 4–10): Core MVP
- Live Copilot v1 (web + desktop minimal overlay).
- Mock interviews v1.
- Resume parse + JD matching v1.
- Job tracker v1 (manual import).
- Basic analytics dashboard.

## Phase 2 (Weeks 11–17): Scale & Depth
- Coding copilot v1 + complexity scoring.
- Job board/API imports + fit scoring.
- Advanced post-session reports and coaching plans.
- Billing/paywall + usage limits.

## Phase 3 (Weeks 18–24): Reliability & GTM
- Performance hardening + failover flows.
- Compliance pack (audit logs, export/delete workflows).
- Growth loops (referrals, streaks, nudges).
- Beta→GA readiness checks.

---

## 12) Milestones, Tickets, and Backlog

## Milestone M0: Platform Foundation
**Goal:** Production-capable base.
- FE-001: App shell + auth flows + onboarding scaffolding.
- FE-002: Design system primitives + accessibility baseline.
- BE-001: API gateway + auth service + RBAC.
- BE-002: PostgreSQL schema migrations (profiles/sessions/jobs/resumes).
- BE-003: Event ingestion pipeline + analytics event contract.
- DEV-001: CI/CD, environments, IaC baseline, secrets management.
- QA-001: Test harness (unit/integration/e2e skeleton).

## Milestone M1: Live Copilot + Mock MVP
**Goal:** End-to-end interview prep loop.
- FE-010: Realtime interview UI + suggestion card stack.
- FE-011: Session controls (hotkeys, hide/mute, session timer).
- FE-012: Mock interview flow UI + score report page.
- BE-010: Streaming session endpoint + WS transport.
- BE-011: STT adapter + transcript persistence.
- BE-012: Copilot orchestration (prompt templates + role packs).
- BE-013: Mock scoring engine + rubric service.
- QA-010: Latency/load test for realtime paths.

## Milestone M2: Resume + Job Hunter
**Goal:** Convert prep into applications.
- FE-020: Resume upload/analyze/rewrite UI.
- FE-021: Job board Kanban + follow-up reminders.
- BE-020: Resume parsing + ATS scoring.
- BE-021: JD match engine + recommendation service.
- BE-022: Job import adapters + de-duplication.
- BE-023: Application pipeline APIs + reminders scheduler.
- DATA-020: Funnel and conversion dashboard datasets.

## Milestone M3: Coding Copilot + Advanced Analytics
**Goal:** Technical interview differentiation.
- FE-030: Coding session workspace + hint ladder UI.
- FE-031: Post-coding report and edge-case explorer.
- BE-030: Coding evaluator service (complexity + quality).
- BE-031: Test-case generator + execution sandbox.
- BE-032: Personalized weakness model + coaching insights.
- DATA-030: Cohort retention and model cost analytics.

## Milestone M4: Compliance & GA
**Goal:** Enterprise-ready trust and launch.
- SEC-040: Audit logs, consent records, and access reviews.
- SEC-041: Data export/delete workflows.
- OPS-040: Multi-region failover + SLO dashboards.
- GTM-040: Pricing packaging + plan enforcement.
- QA-040: Full regression + chaos and disaster recovery drills.

---

## 13) Acceptance Criteria (Execution-Level)

## 13.1 Live Copilot
- Given active session, when transcript chunk arrives, user sees suggestion within 3 seconds (p75).
- Suggestion includes category tag (answer, clarify, STAR, follow-up).
- User can hide/reveal overlay in <100 ms interaction response.

## 13.2 Coding Copilot
- For coding prompt, system returns at least 3-tier hint ladder.
- Complexity estimate includes Big-O time and space with rationale.
- “No full-code mode” suppresses complete solutions.

## 13.3 Mock Interviews
- Session concludes with overall score + >=3 strengths + >=3 weaknesses + prioritized plan.
- Transcript and report remain accessible in history.

## 13.4 Resume
- Parsing success >95% on supported formats.
- JD analysis returns match score and top missing keywords.
- Rewrite output preserves factual constraints and quant style guardrails.

## 13.5 Job Hunter
- User can create/update pipeline stages and reminders.
- Imported jobs are deduplicated by source/external-id/title/company heuristic.

## 13.6 Analytics
- Dashboard loads in <2 seconds for typical user account.
- Metrics reconcile with raw events within ±1% daily tolerance.

## 13.7 Security/Compliance
- All PII fields encrypted at rest.
- Consent captured before interview recording/transcription.
- User can request deletion/export and complete within SLA.

---

## 14) QA Strategy

- **Unit tests:** business logic (scoring, matching, parsing).
- **Integration tests:** API contracts, DB transactions, queue workflows.
- **E2E tests:** onboarding → interview → report → application tracking.
- **Performance tests:** realtime latency and throughput under burst load.
- **Security tests:** SAST/DAST, authZ tests, dependency scans.
- **AI eval harness:** regression set for prompt quality and hallucination rates.

---

## 15) Observability & SLOs

- Metrics: session starts, hint latency, STT errors, model errors, API p95.
- Tracing: per-session distributed trace with redaction.
- Alerting: error budget burn, provider degradation, queue lag.
- SLOs:
  - Realtime session availability: 99.9%
  - Dashboard/API availability: 99.5%
  - Critical error rate: <0.5%

---

## 16) Risks & Mitigations

1. **Realtime latency spikes** → multi-provider failover, precomputed templates, queue tuning.
2. **Model hallucinations** → retrieval grounding + confidence display + guardrails.
3. **Policy misuse concerns** → explicit user controls, usage policy, strict logs.
4. **Job API fragility** → adapter abstraction + retries + data normalization.
5. **Cost overruns** → dynamic model routing, caching, plan limits.

---

## 17) Dependencies

- STT/LLM vendor contracts and quotas.
- Desktop app signing/notarization pipeline.
- Job board API partner approvals.
- Legal review for recording and advice disclaimers by region.

---

## 18) Launch Readiness Checklist

- [ ] M0–M4 tickets complete and accepted.
- [ ] Incident runbooks tested.
- [ ] Compliance/legal sign-off completed.
- [ ] Pricing + billing smoke tested.
- [ ] Analytics instrumentation verified.
- [ ] Beta cohort feedback integrated.

---

## 19) Appendix: Recommended Engineering Conventions

- API-first development with OpenAPI specs.
- Feature flags for all new high-risk modules.
- Contract tests between FE/BFF and internal services.
- Backward-compatible DB migrations with roll-forward strategy.
- Weekly product/eng triage using this backlog as source-of-truth.

---

## 20) Delivery Cadence Suggestion

- **Sprint length:** 2 weeks
- **Ceremonies:** planning, demo, retro, architecture sync
- **Reporting:** milestone burndown + risk register weekly
- **Ownership model:** module DRI + cross-functional QA and data partners

This PRD is structured to transition directly into Jira/Linear epics and implementation tickets with minimal decomposition overhead.
