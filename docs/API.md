# API reference

Generated from the route files in `src/app/api` by `node scripts/gen-api-docs.mjs`. Don’t edit it by hand: change the comment above the route’s handler and run the script again.

Every route answers JSON. Signed-in routes read the Supabase session cookie; most also apply rate limits and validate bodies with zod. Cron routes take `Authorization: Bearer <CRON_SECRET>`; the Stripe webhook checks Stripe’s signature. The live transcription relay is a WebSocket at `/api/stt/stream`, served by `server.ts` rather than a route file.

## admin

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/admin/analytics` | the Overview's figures, counted from the live tables on each request. |
| `GET` | `/api/admin/fraud` |  |
| `POST` | `/api/admin/fraud` |  |
| `PATCH` | `/api/admin/fraud` |  |
| `GET` | `/api/admin/subscriptions` |  |
| `PATCH` | `/api/admin/subscriptions` | PATCH: cancel (at the end of the period) or resume a subscription. |
| `GET` | `/api/admin/tickets` |  |
| `POST` | `/api/admin/tickets` |  |
| `PATCH` | `/api/admin/tickets` |  |
| `GET` | `/api/admin/users` |  |
| `PATCH` | `/api/admin/users` |  |

## analytics

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/analytics/funnel` | The signed-in user's job-search funnel, from their Jobs board (active jobs). |
| `GET` | `/api/analytics/overview` | The signed-in user's own live sessions, practice interviews and scored reports from the lookback window. |
| `GET` | `/api/analytics/reconciliation` |  |
| `GET` | `/api/analytics/reports` |  |
| `POST` | `/api/analytics/reports` | {report_type, frequency} |
| `PUT` | `/api/analytics/reports` | {id, enabled} |
| `DELETE` | `/api/analytics/reports` |  |
| `POST` | `/api/analytics/reports/send` | {id} - email one of the user's reports now |
| `GET` | `/api/analytics/weekly` | The signed-in user's activity per week for the last 8 weeks: practice interviews and their scores, live sessions and minutes, applications sent. |

## auth

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/auth/callback` | Where Supabase Auth sends the browser back after single sign-on (and other code-based sign-ins): swaps the code for a session cookie, adds SSO users to their team, then continues to `next`. |

## badges

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/badges` | Get all badges for the current user |

## billing

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/billing/checkout` | starts a Stripe Checkout for Pro and returns |
| `POST` | `/api/billing/portal` | opens Stripe's billing portal (change card, |

## copilot

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/copilot/sessions/[id]` |  |
| `DELETE` | `/api/copilot/sessions/[id]` |  |
| `POST` | `/api/copilot/sessions/[id]/answer` | streams an answer to one |
| `POST` | `/api/copilot/sessions/[id]/gate` | fast yes/no: should the candidate get |
| `POST` | `/api/copilot/sessions/[id]/heartbeat` |  |
| `POST` | `/api/copilot/sessions/[id]/latency` | stores how long each answered |
| `GET` | `/api/copilot/sessions/[id]/report` |  |
| `POST` | `/api/copilot/sessions/[id]/screen` | "Solve screen" (build plan Step 9). |
| `GET` | `/api/copilot/sessions/[id]/stream` |  |
| `POST` | `/api/copilot/sessions/[id]/summarize` | the session's interview report, |
| `POST` | `/api/copilot/sessions/[id]/transcript` |  |
| `GET` | `/api/copilot/sessions/export` |  |
| `GET` | `/api/copilot/sessions/history` |  |
| `DELETE` | `/api/copilot/sessions/purge` |  |
| `POST` | `/api/copilot/sessions/start` |  |
| `POST` | `/api/copilot/sessions/stop` |  |

## cover-letters

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/cover-letters` | List all cover letters for the authenticated user |
| `POST` | `/api/cover-letters` | Generate a new cover letter |
| `GET` | `/api/cover-letters/[id]` | Get a specific cover letter |
| `PATCH` | `/api/cover-letters/[id]` | Update a cover letter |
| `DELETE` | `/api/cover-letters/[id]` | Delete a cover letter |
| `GET` | `/api/cover-letters/[id]/export` | Export a cover letter in the requested format |

## cron

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/cron/notifications` |  |
| `POST` | `/api/cron/notifications` |  |
| `GET` | `/api/cron/retention` |  |
| `POST` | `/api/cron/retention` | Also support POST for manual triggers |

## health

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/health` |  |
| `HEAD` | `/api/health` | Simple health check endpoint for offline detection |

## interviews

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/interviews` |  |
| `POST` | `/api/interviews` |  |
| `GET` | `/api/interviews/[id]` |  |
| `PATCH` | `/api/interviews/[id]` | Rename. |
| `DELETE` | `/api/interviews/[id]` | Delete, with its questions and reports (the foreign keys cascade too). |
| `GET` | `/api/interviews/[id]/export` | one interview as a JSON file (the practice report's Export): the session, its questions with your answers and the feedback on each, the report, and the chat messages older interviews kept. |
| `POST` | `/api/interviews/[id]/practice/answer` | Saves an answer to one practice question and returns the coach's feedback on it. |
| `POST` | `/api/interviews/[id]/practice/start` | Starts a practice interview: the model writes the questions for the role (and the résumé and job, when given), and they are saved in order. |
| `GET` | `/api/interviews/[id]/report` |  |
| `POST` | `/api/interviews/[id]/report` |  |

## materials

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/materials/upload` |  |

## notifications

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/notifications/preferences` |  |
| `PATCH` | `/api/notifications/preferences` |  |

## push

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/push/subscriptions` | register this browser |
| `DELETE` | `/api/push/subscriptions` | {endpoint} - stop notifications on this browser |
| `GET` | `/api/push/vapid-key` | the public key browsers subscribe with; `publicKey: null` when push isn't set up on this server (an ordinary answer, not an error: Settings asks on every visit). |

## question-bank

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/question-bank` | that company's bank (yours and shared) GET /api/question-bank?q=ac - companies with a bank: yours and shared ones |
| `POST` | `/api/question-bank` | {company, role?, question, type, shared} - a question you were asked |
| `PATCH` | `/api/question-bank/[id]` | {shared} - share one of your questions, or stop sharing it |
| `DELETE` | `/api/question-bank/[id]` | remove one of your questions (and its shared copy) |

## referrals

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/referrals` | the user's referral code and the people who signed up with it. |
| `POST` | `/api/referrals/claim` | Credits the referrer whose link this account signed up with. |

## resume

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/resume/[id]/analyze` |  |
| `POST` | `/api/resume/[id]/bullets` |  |
| `GET` | `/api/resume/[id]/download` |  |
| `POST` | `/api/resume/[id]/keywords` |  |
| `DELETE` | `/api/resume/documents/[id]` | the user's own uploaded résumé: the file in storage and its row. |
| `POST` | `/api/resume/generate` |  |
| `GET` | `/api/resume/history` |  |
| `POST` | `/api/resume/upload` | (multipart: file; ?autoParse=false to skip reading it) - stores the file in the résumés bucket under the user's own folder (always: the bucket isn't the caller's choice) and saves its text. |

## settings

| Method | Path | What it does |
| --- | --- | --- |
| `DELETE` | `/api/settings/account` | deletes the signed-in account once the user has typed its email. |
| `GET` | `/api/settings/llm` |  |
| `PATCH` | `/api/settings/llm` |  |
| `GET` | `/api/settings/profile` |  |
| `PATCH` | `/api/settings/profile` |  |
| `GET` | `/api/settings/video-conferencing` | conferencing |
| `PATCH` | `/api/settings/video-conferencing` | the whole settings object |

## social

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/social/shares` | Get user's social share history |
| `POST` | `/api/social/shares` | Record a social share. |
| `PUT` | `/api/social/shares` | Generate share URLs for different platforms |

## support

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/support` | the user's tickets, newest first, with the conversation |
| `POST` | `/api/support` | {subject, description, category} - open a ticket |
| `POST` | `/api/support/[id]/messages` | {content} - the user's reply on their ticket |

## teams

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/teams` | List user's organizations |
| `POST` | `/api/teams` | Create new organization |
| `GET` | `/api/teams/[id]` | Get organization details |
| `PATCH` | `/api/teams/[id]` | Update organization |
| `DELETE` | `/api/teams/[id]` | Delete organization |
| `GET` | `/api/teams/[id]/analytics` | Get team analytics (any member, viewers included: they see the same team page) |
| `GET` | `/api/teams/[id]/invitations` | pending invitations, each with its link (owners and admins) |
| `POST` | `/api/teams/[id]/invitations` | invite (or invite again) an email address; only the owner invites an admin. |
| `DELETE` | `/api/teams/[id]/invitations` | cancel an invitation; one as admin is the owner's to cancel. |
| `GET` | `/api/teams/[id]/members` | List team members, with their names, emails and photos |
| `PATCH` | `/api/teams/[id]/members` | {member_id, action: 'remove' \| 'update_role', role?} Owners and admins manage members; only the owner manages admins. |
| `GET` | `/api/teams/[id]/sso` |  |
| `PUT` | `/api/teams/[id]/sso` | {domains, metadataUrl \| metadataXml} - turn on, or update |
| `DELETE` | `/api/teams/[id]/sso` | turn off and remove the identity provider |
| `GET` | `/api/teams/invitations` | pending invitations sent to the signed-in user's address |
| `GET` | `/api/teams/invitations/[token]` | what the link is for (team, role, address), before signing in |
| `POST` | `/api/teams/invitations/[token]` | {action} - join the team, or decline |

## usage

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/api/usage` | the signed-in user's plan, and this period's usage against its limits. |

## webhooks

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/webhooks/stripe` | Stripe webhook. |
